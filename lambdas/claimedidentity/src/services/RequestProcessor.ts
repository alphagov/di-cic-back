import {CicSession} from "../models/CicSession";
import {Response} from "../utils/Response";
import {StatusCodes} from "http-status-codes";
import {CicService} from "./CicService";
import {Metrics,MetricUnits} from "@aws-lambda-powertools/metrics";
import {randomUUID} from "crypto";
import {APIGatewayProxyEvent} from "aws-lambda";
import { Logger } from '@aws-lambda-powertools/logger';
import {ValidationHelper} from "../utils/ValidationHelper";


export class RequestProcessor {

    private static instance: RequestProcessor;
    private readonly logger: Logger;
    private readonly metrics: Metrics;
    private readonly validationHelper: ValidationHelper;
    public cicService: CicService;

    constructor(logger: Logger, metrics: Metrics) {
        this.logger = logger;
        this.validationHelper = new ValidationHelper();
        this.metrics = metrics;
        this.cicService = CicService.getInstance(process.env.SESSION_TABLE_NAME as string, this.logger);
    }

    static getInstance(logger:Logger, metrics: Metrics): RequestProcessor {
        if (!RequestProcessor.instance) {
            RequestProcessor.instance = new RequestProcessor(logger, metrics);
        }
        return RequestProcessor.instance;
    }
    async processRequest(event: APIGatewayProxyEvent, sessionId: string): Promise<Response>{
        let cicSession;
        try {
            const bodyParsed = JSON.parse(event.body as string);
            cicSession = new CicSession(bodyParsed);
            await this.validationHelper.validateModel(cicSession, this.logger);
            this.logger.debug("CIC Session is   *****"+JSON.stringify(cicSession));
        } catch (error){
            return new Response(StatusCodes.BAD_REQUEST,"Missing mandatory fields in the request payload");
        }

        const session = await this.cicService.getSessionById(sessionId);

        if(session){
            this.logger.info('found session', JSON.stringify(session));
            this.metrics.addMetric('found session', MetricUnits.Count, 1);
            this.logger.debug("Session is   *****"+JSON.stringify(session));
            await this.cicService.saveCICData(sessionId, cicSession);
            const authCode = randomUUID();
            await this.cicService.createAuthorizationCode(sessionId, authCode)
            const resp = {
                authorizationCode: authCode,
                redirectUri: session?.redirectUri,
                state: session?.state
            }
            return new Response(StatusCodes.NO_CONTENT,JSON.stringify(resp));
        } else{
            return new Response(StatusCodes.NOT_FOUND,`No session found with the session id: ${sessionId}`);
        }

    }
}
