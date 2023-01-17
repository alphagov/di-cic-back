import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CICService } from "./services/cic-service";
import {CICSession} from "./models/CICSession";
import {validateModel} from "./aws/ValidationHelper"

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let response: APIGatewayProxyResult;
    try {
        console.log("Body is "+event.body as string)
        const bodyParsed = JSON.parse(event.body as string);
        const sessionId = event.headers["session_id"] as string;
        if (!sessionId) {
            response = {
                statusCode: 400,
                body: "Missing header: session_id is required",
            };
            return response;
        }

        if (bodyParsed) {
            const cicSession: CICSession = new CICSession(bodyParsed);
            await validateModel(cicSession);
            console.log("CIC Session is   *****"+JSON.stringify(cicSession));
            const cicService = new CICService(process.env.SESSION_TABLE_NAME);
            const session = await cicService.getSessionById(sessionId);
            console.log("Session is   *****"+JSON.stringify(session));
            session.fullName = cicSession.fullName;
            await cicService.saveCICData(sessionId, cicSession);
            const result = null;

            response = {
                statusCode: 200,
                body: JSON.stringify({}),
            };

        }else {
            response = {
                statusCode: 400,
                body: "Empty: session_id is required",
            };
            return response;
            response = {
                statusCode: 500,
                body: "An error has occurred. " ,
            };
        }

        //if (bodyParsed) {
        //SessionItem session = sessionService.validateSessionId(sessionId);
        //eventProbe.log(Level.INFO, "found session");

        // Save our addresses to the address table
        //c.saveAddresses(UUID.fromString(sessionId), addresses);

        // Now we've saved our address, we need to create an authorization code for the
        // session
        //sessionService.createAuthorizationCode(session);

        //eventProbe.counterMetric(LAMBDA_NAME);
        // return ApiGatewayResponseGenerator.proxyJsonResponse(HttpStatusCode.NO_CONTENT, "");
        //}

        // If we don't have at least one address, do not save
        //return ApiGatewayResponseGenerator.proxyJsonResponse(HttpStatusCode.OK, "");
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        response = {
            statusCode: 500,
            body: "An error has occurred. " + err,
        };
    }
    return response;
};


