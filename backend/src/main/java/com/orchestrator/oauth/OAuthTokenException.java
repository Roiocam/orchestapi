package com.orchestrator.oauth;

public class OAuthTokenException extends RuntimeException {

    private final OAuthTokenErrorCode code;
    private final Integer httpStatus;

    public OAuthTokenException(OAuthTokenErrorCode code, String message) {
        this(code, message, null, null);
    }

    public OAuthTokenException(OAuthTokenErrorCode code, String message, Integer httpStatus) {
        this(code, message, httpStatus, null);
    }

    public OAuthTokenException(OAuthTokenErrorCode code, String message, Throwable cause) {
        this(code, message, null, cause);
    }

    private OAuthTokenException(
            OAuthTokenErrorCode code, String message, Integer httpStatus, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.httpStatus = httpStatus;
    }

    public OAuthTokenErrorCode getCode() {
        return code;
    }

    public Integer getHttpStatus() {
        return httpStatus;
    }
}
