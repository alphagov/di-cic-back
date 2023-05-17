import { Logger } from "@aws-lambda-powertools/logger";
import { VerifiedCredential } from "./IVeriCredential";
import { KmsJwtAdapter } from "./KmsJwtAdapter";
import { ISessionItem } from "../models/ISessionItem";
import { AppError } from "./AppError";
import { HttpCodesEnum } from "./HttpCodesEnum";
import { Constants } from "./Constants";
import { randomUUID } from "crypto";

export class VerifiableCredentialService {
    readonly tableName: string;

    readonly logger: Logger;

	readonly issuer: string;

    private readonly kmsJwtAdapter: KmsJwtAdapter;

    private static instance: VerifiableCredentialService;

    constructor(tableName: any, kmsJwtAdapter: KmsJwtAdapter, issuer: any, logger: Logger ) {
    	this.issuer = issuer;
    	this.tableName = tableName;
    	this.logger = logger;
    	this.kmsJwtAdapter = kmsJwtAdapter;
    }

    static getInstance(tableName: string, kmsJwtAdapter: KmsJwtAdapter, issuer: string, logger: Logger): VerifiableCredentialService {
    	if (!VerifiableCredentialService.instance) {
    		VerifiableCredentialService.instance = new VerifiableCredentialService(tableName, kmsJwtAdapter, issuer, logger);
    	}
    	return VerifiableCredentialService.instance;
    }

    async generateSignedVerifiableCredentialJwt(sessionItem: ISessionItem, getNow: () => number): Promise<string> {
    	const now = getNow();
    	const subject = sessionItem.subject;
    	const nameParts = this.buildVcNamePart(sessionItem?.given_names, sessionItem?.family_names);
    	const verifiedCredential: VerifiedCredential = new VerifiableCredentialBuilder(nameParts, sessionItem?.date_of_birth)
    		.build();
    	const result = {
    		sub: subject,
    		nbf: now,
    		iss: this.issuer,
    		iat: now,
    		jti: randomUUID(),
    		vc: verifiedCredential,
    	};

    	this.logger.info("Generated VerifiableCredential jwt", {
    		sessionId: sessionItem.sessionId,
    		govuk_signin_journey_id: sessionItem.clientSessionId,
    		jti: result.jti,
    	});
    	try {
    		// Sign the VC
    		return await this.kmsJwtAdapter.sign(result);
    	} catch (error) {
    		this.logger.error("Failed to sign Jwt", {
    			error,
    			sessionId: sessionItem.sessionId,
    			govuk_signin_journey_id: sessionItem.clientSessionId,
    		});
    		throw new AppError( "Server Error", HttpCodesEnum.SERVER_ERROR);
    	}
    }

    buildVcNamePart(given_names: string[] | undefined, family_names: string[] | undefined): object[] {
    	const parts:object[] = [];
    	given_names?.forEach((givenName)=>{
    		parts.push(
    			{
    				value: givenName,
    				type: "GivenName",
    			},
    		);
    	});
    	family_names?.forEach((familyName)=>{
    		parts.push(
    			{
    				value: familyName,
    				type: "FamilyName",
    			},
    		);
    	});
    	return parts;
    }
}
class VerifiableCredentialBuilder {
    private readonly credential: VerifiedCredential;

    constructor(nameParts: object[], date_of_birth: string | undefined) {
    	this.credential = {
    		"@context": [
    			Constants.W3_BASE_CONTEXT,
    			Constants.DI_CONTEXT,
    		],
    		type: [
    			Constants.VERIFIABLE_CREDENTIAL,
    			Constants.IDENTITY_ASSERTION_CREDENTIAL,
    		],
    		credentialSubject: {
    			name: [
    				{
    					nameParts,
    				}],
    			birthDate: [{ value: date_of_birth }],
    		},
    	};
    }

    build(): VerifiedCredential {
    	return this.credential;
    }

}
