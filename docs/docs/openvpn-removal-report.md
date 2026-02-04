# OpenVPN removal report

This report summarizes the OpenVPN integration elements removed from the repository.

## Backend

- Deleted the OpenVPN service module and its encryption/helpers, along with OpenVPN-specific models and relationships.
- Removed OpenVPN fields from the tenant API schemas and tenant response payloads.
- Deleted OpenVPN admin endpoints (generate/revoke/download profile, TLS status) and related validation logic.
- Removed OpenVPN-related tests and migration history entries.

## Frontend

- Removed all OpenVPN UI components, dialogs, and tests.
- Simplified the tenant networking dialog to focus only on UniFi controller configuration.

## Infrastructure & configuration

- Dropped the OpenVPN Docker service, volume, and init script.
- Removed OpenVPN environment variables from sample configuration files.
- Removed OpenVPN build dependencies from the backend Docker image.

## Documentation

- Removed OpenVPN references from the product spec and admin/operations docs.
- Added this report to document the removal scope.
