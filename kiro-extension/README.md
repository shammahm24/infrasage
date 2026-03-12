# InfraSage Kiro Extension

InfraSage runs Terraform audits on save and shows results in the InfraSage panel.

## Setup

1. Install the extension (load from the `kiro-extension` folder or package the VSIX).
2. Set **InfraSage API base URL** in settings:
   - Open Settings, search for `infrasage.apiBaseUrl`.
   - Set it to your API Gateway invoke URL (e.g. `https://xxx.execute-api.us-east-1.amazonaws.com/prod`).

## Usage

- **Save a `.tf` file** – The extension calls `POST /audit` and shows the result in the **InfraSage** panel (Audit Results tab).
- **Audit Results tab** – Alignment score (color-coded), violation list, diff preview, **Apply Patch**, **Re-run Audit**.
- **Governance Summary tab** – Average alignment, trend, total carbon delta, violations resolved, recent audits. Use **Refresh** to reload.

Apply Patch parses the unified diff, updates the file, saves, marks the audit as applied via the API, and re-runs the audit.

## Build

```bash
npm install
npm run compile
```

Then load the folder in Kiro/VS Code (or package as VSIX).
