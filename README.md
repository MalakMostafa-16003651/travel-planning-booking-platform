# Travel Planning and Booking Platform

GIU Software Project I — Winter 2026

Backend: NestJS  
Frontend: Next.js  
Database: MongoDB Atlas

## Current implementation

ACC-01 user registration is the first implemented backend feature. It
accepts name, email, password, and terms-and-privacy consent; creates a `USER`
account with `ACTIVE` status; stores a salted password hash; and returns only
public account fields. Login and session management are the next step.

See [backend setup and registration API documentation](backend/README.md) for
installation, environment configuration, Swagger, manual checks, and isolated
MongoDB tests.

The [Authentication and Users shared contract](docs/requirements/authentication-contract-proposal.md)
records the accepted User fields and naming, along with details deferred to later
features.

## Contributing

Follow the [team development workflow](CONTRIBUTING.md) for branches, continuous
student logs, AI attribution, verification, and human review. Create each student's
log once from the [template](docs/work-logs/TEMPLATE.md), then append dated entries
to the same file throughout the project.
