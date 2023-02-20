"use strict";
/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    transform: {
        '^.+\\.ts?$': 'ts-jest'
    },
    clearMocks: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageProvider: 'v8',
    coveragePathIgnorePatterns: ['config.ts', 'node_modules/'],
    testMatch: ['**/tests/**/*.test.ts'],
    setupFiles: [
        './jest.setup.ts'
    ],
    testEnvironment: 'node'
};
