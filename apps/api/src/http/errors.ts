import type { UseCaseErrorCode } from "@gen-story/application";
import type { ApiErrorDto } from "@gen-story/shared";

export function useCaseErrorToStatus(code: UseCaseErrorCode): number {
  switch (code) {
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "validation_error":
      return 422;
    case "invalid_state":
      return 422;
  }
}

export function errorBody(code: string, message: string): ApiErrorDto {
  return { error: { code, message } };
}

export function notFoundBody(message = "Not found."): ApiErrorDto {
  return errorBody("not_found", message);
}

export function forbiddenBody(message = "Forbidden."): ApiErrorDto {
  return errorBody("forbidden", message);
}

export function badRequestBody(message: string): ApiErrorDto {
  return errorBody("bad_request", message);
}

export function unauthorizedBody(message = "Unauthorized."): ApiErrorDto {
  return errorBody("unauthorized", message);
}

export function internalErrorBody(): ApiErrorDto {
  return errorBody("internal_error", "An unexpected error occurred.");
}
