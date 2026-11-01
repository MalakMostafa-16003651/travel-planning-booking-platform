# Backend: ACC-01 user registration

This NestJS 12 backend implements the registration part of Accounts & Users. It uses TypeScript, Mongoose, and the team's MongoDB Atlas database. Registration creates a normal account; it does not log the user in or issue authentication cookies. Login and session management belong to later requirements.

## Run locally

Install Node.js 24 LTS with npm. Create the repository-root `.env` using the root `.env.example`, and enter the team's private connection string locally. Keep `.env` out of Git.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Required connection string for the team's MongoDB Atlas database. |
| `PORT` | Optional HTTP port; defaults to `3000`. |

When launched from `backend/`, the application reads the repository-root file at `../.env`. Registration does not require a JWT secret.

Run these commands in a terminal whose current directory is `backend/`:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run start:dev
```

`npm ci` installs the exact locked dependencies. `npm run build` compiles TypeScript. `npm run start:dev` watches TypeScript files and restarts the Nest application after each successful compilation. The examples use `npm.cmd` so they work with Windows PowerShell's default execution policy; use `npm` on macOS or Linux.

To run the compiled application, stop the development server and use:

```powershell
npm.cmd run build
npm.cmd run start:prod
```

With the default port, open:

- Swagger UI: <http://localhost:3000/api/docs>
- OpenAPI JSON: <http://localhost:3000/api/docs-json>

Use the configured port in both URLs if `PORT` is changed. Startup requires a working MongoDB connection.

## Registration API

`POST /api/auth/register` accepts a JSON body:

```json
{
  "name": "Travel Tester",
  "email": "travel.tester@example.com",
  "password": "Travel2026",
  "termsAccepted": true
}
```

| Field | Rules |
| --- | --- |
| `name` | A name string; surrounding whitespace is trimmed. |
| `email` | A valid email address; surrounding whitespace is trimmed and letters are converted to lowercase before storage. It must be unique. |
| `password` | At least eight characters, including at least one Unicode letter and one Unicode decimal digit. |
| `termsAccepted` | Must be the literal boolean `true`. Missing consent, `false`, and the string `"true"` are rejected. |

Unknown fields are rejected. The caller cannot choose `role`, `status`, or a user ID during registration. The backend assigns role `USER` and account status `ACTIVE`.

A successful request returns **201 Created** with the public account fields:

```json
{
  "userId": "507f1f77bcf86cd799439011",
  "name": "Travel Tester",
  "email": "travel.tester@example.com",
  "role": "USER",
  "status": "ACTIVE",
  "createdAt": "2026-11-01T10:00:00.000Z",
  "updatedAt": "2026-11-01T10:00:00.000Z"
}
```

The ID and timestamps above are examples. MongoDB stores the document's `_id`; the API exposes it as `userId`. Passwords and password hashes are excluded from the response.

Invalid input returns **400 Bad Request**, with `statusCode: 400`, `error: "Bad Request"`, `message: "Validation failed"`, and an `errors` object mapping field names to arrays of validation messages. A registered email returns **409 Conflict**:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Email is already registered",
  "errors": {
    "email": ["Email is already registered"]
  }
}
```

Email uniqueness applies after normalization, so `Travel.Tester@example.com` and ` travel.tester@example.com ` refer to the same email.

## How a request reaches MongoDB

1. `RegisterDto` describes the accepted input. Nest's validation pipeline normalizes the name and email, checks each field, and rejects unknown properties before the request reaches the service.
2. The authentication controller passes the validated input to `AuthService`, which coordinates registration.
3. `PasswordService` uses asynchronous Node.js `scrypt` with a random salt to create the password hash. Plaintext passwords are not stored.
4. `UsersService` saves the account through the Mongoose user model. The database enforces email uniqueness, and Mongoose provides `createdAt` and `updatedAt` timestamps.
5. The service returns the public account fields, and the controller sends the 201 response.

The shared role enum contains `USER`, `ADMIN`, `AIRLINE_MODERATOR`, and `HOTEL_MODERATOR`. The shared account-status enum contains `ACTIVE`, `SUSPENDED`, and `DEACTIVATED`. Other modules should import these shared definitions when needed. Registration always assigns `USER` and `ACTIVE`; privileged account creation is outside ACC-01.

For the framework mechanisms used here, see the official [Nest validation documentation](https://docs.nestjs.com/techniques/validation), [Nest Mongoose integration documentation](https://docs.nestjs.com/techniques/mongodb), and [Node.js 24 scrypt documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

## Verify the endpoint in Swagger

Start the backend, open Swagger UI, expand `POST /api/auth/register`, and select **Try it out**. These requests create test accounts in the configured database, so use distinct test email addresses.

| Check | Request | Expected result |
| --- | --- | --- |
| Valid registration | Send the sample body with an unused email. | 201; role `USER`, status `ACTIVE`, normalized email, and public account fields. |
| Normalization | Use an unused email with surrounding spaces and uppercase letters, and a name with surrounding spaces. | 201; trimmed name and lowercase, trimmed email. |
| Duplicate email | Repeat a successful email using different capitalization or surrounding spaces. | 409; no second account is created. |
| Invalid email | Set `email` to `not-an-email`. | 400; an email validation message. |
| Short password | Set `password` to `Trip1`. | 400; a password validation message. |
| Missing letter or digit | Try `12345678`, then `abcdefgh`. | 400 for each request. |
| Missing consent | Remove `termsAccepted`, set it to `false`, or use `"true"`. | 400 for each request. |
| Role injection | Add `"role": "ADMIN"` to the sample body. | 400; registration cannot assign privileged roles. |
| Unknown property | Add an extra field such as `"unexpected": true`. | 400; the field is rejected. |

## Automated tests

From `backend/`, run:

```powershell
npm.cmd test
```

The tests use an isolated local MongoDB instance and never connect to the team's Atlas database. On Windows, the test helper first checks for an installed MongoDB server executable and starts a separate instance with a fresh temporary database directory. If no installed executable is found, it downloads and caches a test binary; the first uncached download may take time. This verifies registration without creating or deleting records in the shared database.
