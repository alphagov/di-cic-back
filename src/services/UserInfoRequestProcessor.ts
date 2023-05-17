import { Response } from "../utils/Response";
import { CicService } from "./CicService";
import { Metrics, MetricUnits } from "@aws-lambda-powertools/metrics";
import { APIGatewayProxyEvent } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import { ValidationHelper } from "../utils/ValidationHelper";
import { AppError } from "../utils/AppError";
import { VerifiableCredentialService } from "../utils/VerifiableCredentialService";
import { absoluteTimeNow } from "../utils/DateTimeUtils";
import { HttpCodesEnum } from "../utils/HttpCodesEnum";
import { createDynamoDbClient } from "../utils/DynamoDBFactory";
import { KmsJwtAdapter } from "../utils/KmsJwtAdapter";
import { ISessionItem } from "../models/ISessionItem";
import { AuthSessionState } from "../models/enums/AuthSessionState";
import { buildCoreEventFields } from "../utils/TxmaEvent";

const SESSION_TABLE = process.env.SESSION_TABLE;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN;
const ISSUER = process.env.ISSUER!;

export class UserInfoRequestProcessor {
	private static instance: UserInfoRequestProcessor;

	private readonly logger: Logger;

	private readonly metrics: Metrics;

	private readonly validationHelper: ValidationHelper;

	private readonly cicService: CicService;

	private readonly kmsJwtAdapter: KmsJwtAdapter;

	private readonly verifiableCredentialService: VerifiableCredentialService;

	constructor(logger: Logger, metrics: Metrics) {
		if (!SESSION_TABLE || !ISSUER || !KMS_KEY_ARN) {
			logger.error("Environment variable SESSION_TABLE or ISSUER or KMS_KEY_ARN is not configured");
			throw new AppError("Service incorrectly configured", HttpCodesEnum.SERVER_ERROR);
		}
		this.logger = logger;
		this.validationHelper = new ValidationHelper();
		this.metrics = metrics;
		this.cicService = CicService.getInstance(SESSION_TABLE, this.logger, createDynamoDbClient());
		this.kmsJwtAdapter = new KmsJwtAdapter(KMS_KEY_ARN);
		this.verifiableCredentialService = VerifiableCredentialService.getInstance(SESSION_TABLE, this.kmsJwtAdapter, ISSUER, this.logger);
	}

	static getInstance(logger: Logger, metrics: Metrics): UserInfoRequestProcessor {
		if (!UserInfoRequestProcessor.instance) {
			UserInfoRequestProcessor.instance = new UserInfoRequestProcessor(logger, metrics);
		}
		return UserInfoRequestProcessor.instance;
	}

	async processRequest(event: APIGatewayProxyEvent): Promise<Response> {
		// Validate the Authentication header and retrieve the sub (sessionId) from the JWT token.

		let sub: string;
		try {
			sub = await this.validationHelper.eventToSubjectIdentifier(this.kmsJwtAdapter, event);
		} catch (error) {
			if (error instanceof AppError) {
				this.logger.error("Error validating Authentication Access token from headers: ", { error });
				return new Response(HttpCodesEnum.UNAUTHORIZED, "Failed to Validate - Authentication header: " + error.message);
			}
			this.logger.error("Unexpected error occurred", { error });
			return new Response(HttpCodesEnum.SERVER_ERROR, "Unexpected error occurred");
		}

		let session: ISessionItem | undefined;
		try {
			session = await this.cicService.getSessionById(sub);
			if (!session) {
				this.logger.error("No session found", {
					sessionId: sub,
				});
				return new Response(HttpCodesEnum.UNAUTHORIZED, "Unauthorized");
			}
			this.logger.info("Found Session:", {
				sessionId: sub,
				// note: we only log specific non-PII attributes from the session object:
				govuk_signin_journey_id: session.clientSessionId,
				session: {
					authSessionState: session.authSessionState,
					accessTokenExpiryDate: session.accessTokenExpiryDate,
					attemptCount: session.attemptCount,
					authorizationCodeExpiryDate: session.authorizationCodeExpiryDate,
					createdDate: session.createdDate,
					expiryDate: session.expiryDate,
					redirectUri: session.redirectUri,
				},
			});
		} catch (err) {
			this.logger.error("Error finding session", {
				sessionId: sub,
				err,
			});
			return new Response(HttpCodesEnum.SERVER_ERROR, "Server Error");
		}

		this.metrics.addMetric("found session", MetricUnits.Count, 1);
		// Validate the AuthSessionState to be "CIC_ACCESS_TOKEN_ISSUED"
		if (session.authSessionState !== AuthSessionState.CIC_ACCESS_TOKEN_ISSUED) {
			this.logger.error("Session is in wrong Auth state", {
				sessionId: sub,
				// note: we only log specific non-PII attributes from the session object:
				govuk_signin_journey_id: session.clientSessionId,
				expectedSessionState: AuthSessionState.CIC_ACCESS_TOKEN_ISSUED,
				session: {
					authSessionState: session.authSessionState,
				},
			});
			return new Response(HttpCodesEnum.UNAUTHORIZED, "Unauthorized");
		}

		// Validate the User Info data presence required to generate the VC
		const isValidClaimedIdentity = this.validationHelper.validateClaimedIdentity(session, this.logger);
		if (!isValidClaimedIdentity) {
			this.logger.error("Claimed Identity data invalid", {
				sessionId: sub,
				govuk_signin_journey_id: session.clientSessionId,
			});
			return new Response(HttpCodesEnum.SERVER_ERROR, "Server Error");
		}

		// Generate VC and create a signedVC as response back to IPV Core.
		let signedJWT;
		try {
			signedJWT = await this.verifiableCredentialService.generateSignedVerifiableCredentialJwt(session, absoluteTimeNow);
		} catch (error) {
			if (error instanceof AppError) {
				this.logger.error("Error generating signed verifiable credential jwt", {
					sessionId: sub,
					govuk_signin_journey_id: session.clientSessionId,
					error,
				});
				return new Response(HttpCodesEnum.SERVER_ERROR, "Server Error");
			}
		}
		// Add metric and send TXMA event to the sqsqueue
		this.metrics.addMetric("Generated signed verifiable credential jwt", MetricUnits.Count, 1);
		try {
			await this.cicService.sendToTXMA({
				event_name: "CIC_CRI_VC_ISSUED",
				...buildCoreEventFields(session, ISSUER, session.clientIpAddress, absoluteTimeNow),

			});
		} catch (error) {
			this.logger.error("Failed to write TXMA event CIC_CRI_VC_ISSUED to SQS queue.", {
				sessionId: sub,
				govuk_signin_journey_id: session.clientSessionId,
				error,
			});
		}
		return new Response(HttpCodesEnum.OK, JSON.stringify({
			sub: session.clientId,
			"https://vocab.account.gov.uk/v1/credentialJWT": [signedJWT],
		}));
	}
}
