package com.orchestrator.oauth;

public class OAuthTokenException extends RuntimeException {

    private final OAuthTokenErrorCode code;
    private final Integer httpStatus;

    public OAuthTokenException(OAuthTokenErrorCode code, String message) {
        this(code, message, null);
    }

    public OAuthTokenException(OAuthTokenErrorCode code, String message, Integer httpStatus) {
        super(message);
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
