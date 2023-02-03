import { CicSession } from "../models/CicSession";
import { Response } from "../utils/Response";
import { CicService } from "./CicService";
import { Metrics, MetricUnits } from "@aws-lambda-powertools/metrics";
import { randomUUID } from "crypto";
import { APIGatewayProxyEvent } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import { ValidationHelper } from "../utils/ValidationHelper";
import { CicResponse } from "../utils/CicResponse";
import { AppError } from "../utils/AppError";
import { HttpCodesEnum } from "../utils/HttpCodesEnum";

const SESSION_TABLE = process.env.SESSION_TABLE;

export class RequestProcessor {
	private static instance: RequestProcessor;

	private readonly logger: Logger;

	private readonly metrics: Metrics;

	private readonly validationHelper: ValidationHelper;

	private readonly cicService: CicService;

	constructor(logger: Logger, metrics: Metrics) {
		if (!SESSION_TABLE) {
			logger.error("Environment variable SESSION_TABLE is not configured");
			throw new AppError( "Service incorrectly configured", 500);
		}
		this.logger = logger;
		this.validationHelper = new ValidationHelper();
		this.metrics = metrics;

		logger.debug("Table name in RequestProcessor111  "+ SESSION_TABLE);
		this.cicService = CicService.getInstance(SESSION_TABLE, this.logger);
	}

	static getInstance(logger: Logger, metrics: Metrics): RequestProcessor {
		if (!RequestProcessor.instance) {
			RequestProcessor.instance = new RequestProcessor(logger, metrics);
		}
		return RequestProcessor.instance;
	}

	async processRequest(event: APIGatewayProxyEvent, sessionId: string): Promise<Response> {
		let cicSession;
		try {
			this.logger.debug("IN processRequest");
			const bodyParsed = JSON.parse(event.body as string);
			cicSession = new CicSession(bodyParsed);
			await this.validationHelper.validateModel(cicSession, this.logger);
			this.logger.debug("CIC Session is  " + JSON.stringify(cicSession));
		} catch (error) {
			return new Response(HttpCodesEnum.BAD_REQUEST, "Missing mandatory fields in the request payload");
		}

		const session = await this.cicService.getSessionById(sessionId);

		if (session != null) {
			this.logger.info("found session", JSON.stringify(session));
			this.metrics.addMetric("found session", MetricUnits.Count, 1);
			this.logger.debug("Session is " + JSON.stringify(session));
			await this.cicService.saveCICData(sessionId, cicSession);
			const authCode = randomUUID();
			await this.cicService.setAuthorizationCode(sessionId, authCode);
			const cicResp = new CicResponse({
				authorizationCode: authCode,
				redirectUri: session?.redirectUri,
				state: session?.state,
			});

			return new Response(HttpCodesEnum.OK, JSON.stringify(cicResp));
		} else {
			return new Response(HttpCodesEnum.UNAUTHORIZED, `No session found with the session id: ${sessionId}`);
		}
	}
}
