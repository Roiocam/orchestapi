# Cursor pagination for polling steps

## Contract

GET steps may opt into cursor pagination through `cursorPagination` on the step create/update
and JSON import APIs. No configuration means existing retry behavior. Existing editor clients
that omit the field on PUT retain stored configuration; explicit `null` disables it. JSON
export, duplication and suite import preserve the configuration. Apply migration V38 before
running this server version. Older servers do not implement this field.

```json
{
  "name": "read_events",
  "method": "GET",
  "url": "https://api.example.test/events",
  "queryParams": [{"key":"cursor","value":"0"},{"key":"limit","value":"200"}],
  "cursorPagination": {
    "cursorParam": "cursor",
    "nextCursorPath": "/data/nextCursor",
    "itemsPath": "/data/items",
    "maxPages": 100
  },
  "responseHandlers": [{"matchCode":"200","action":"RETRY","retryCount":20,"retryDelaySeconds":4}],
  "responseValidations": [{"validationType":"BODY_FIELD","jsonPath":"$","operator":"CONTAINS","expectedValue":"target-event"}]
}
```

`nextCursorPath` and `itemsPath` are non-root JSON Pointers, not JSONPath expressions. The
items pointer must locate an array-valued object property. Cursor values are opaque strings
or integral numbers, and null/empty string means the current tail. `maxPages` defaults to 100
and accepts 1–1000. POST and steps without response validations or a RETRY handler are rejected.

## Execution

A paginated API must return a non-null next cursor only when the current page is complete.
Unsuccessful validations cause immediate advancement to that cursor, preserving query limits
and other parameters. Completed pages do not consume the idle retry budget. At a null cursor,
the executor waits using the matched RETRY handler's delay and reads the same tail cursor again.
A later tail response replaces the earlier one; completed pages remain in the validation evidence.
This allows evidence in an earlier page and a later page to satisfy the same polling step.

The recorded response body contains the latest response envelope with accumulated items,
not a verbatim single-page HTTP body. The recorded request URL/query reflect the final request.
Extraction and final validations use that same accumulated response. Secrets in request
metadata continue through the existing redaction path.

A repeated cursor, malformed page, maxPages exhaustion or aggregate evidence over 16 MiB fails
with an explicit error. A successful validation stops without fetching unnecessary pages.
Non-2xx responses use existing handler precedence and never change the page cursor. No URL,
API vendor, numeric cursor arithmetic or event schema is hard-coded into the executor.

## Verification

Use Java 21. Focused Java checks:

```sh
cd backend
bash ./mvnw -Dtest=ExecutionServiceRetryValidationTest,CursorPaginationStateTest,CursorPaginationApiIntegrationTest,ExecutionServiceOAuthTest,TestStepOAuthModeApiTest test
```

`CursorPaginationApiIntegrationTest` uses H2 PostgreSQL mode by default. The real PostgreSQL
verification below creates a disposable container, runs all Flyway migrations, validates the
Hibernate schema and exercises create/read/update/disable/import through MockMvc with real
repositories. It cleans up its own container on exit:

```sh
bash test-script/verify-cursor-pagination-postgres.sh
```

The core regressions were observed failing before the executor change: requests stayed at
cursor 0, evidence disappeared between responses, and repeated cursors burned retries.
Regression coverage also includes 0→200→400, opaque cursor encoding, retry budget independence,
empty tails, page/size bounds, non-2xx retries and preservation during two-pass suite import.
