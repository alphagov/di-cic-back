import { lambdaHandler } from "../../UserInfoHandler";
import { mock } from "jest-mock-extended";
import { VALID_USERINFO, RESOURCE_NOT_FOUND } from "./data/userInfo-events";
import { UserInfoRequestProcessor } from "../../services/UserInfoRequestProcessor";
import { HttpCodesEnum } from "../../utils/HttpCodesEnum";
import { CONTEXT } from "./data/context";

const mockedUserInfoRequestProcessor = mock<UserInfoRequestProcessor>();

jest.mock("../../services/UserInfoRequestProcessor", () => {
	return {
		UserInfoRequestProcessor: jest.fn(() => mockedUserInfoRequestProcessor),
	};
});

describe("UserInfoHandler", () => {
	it("return success response for userInfo", async () => {
		UserInfoRequestProcessor.getInstance = jest.fn().mockReturnValue(mockedUserInfoRequestProcessor);

		await lambdaHandler(VALID_USERINFO, CONTEXT);

		// eslint-disable-next-line @typescript-eslint/unbound-method
		expect(mockedUserInfoRequestProcessor.processRequest).toHaveBeenCalledTimes(1);
	});

	it("return not found when resource not found", async () => {
		UserInfoRequestProcessor.getInstance = jest.fn().mockReturnValue(mockedUserInfoRequestProcessor);

		return expect(lambdaHandler(RESOURCE_NOT_FOUND, CONTEXT)).rejects.toThrow(expect.objectContaining({
			statusCode: HttpCodesEnum.NOT_FOUND,
		}));
	});
});
