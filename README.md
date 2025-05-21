# Cloudflare Worker Dynamic Request Filter

This Cloudflare Worker filters incoming requests based on a dynamic set of rules stored in a KV namespace. Blocked requests and the rules that triggered them are logged to the Workers Analytics Engine.

## Features

- **Dynamic Rule Configuration**: Filtering rules are fetched from a Cloudflare KV namespace, allowing for easy updates without redeploying the worker.
- **Flexible Rule Definitions**: Rules can target request headers, URL components (pathname, search, host, href), or the HTTP method.
- **Various Conditions**: Supports conditions like `equals`, `contains`, `startsWith`, `endsWith`, and `exists`.
- **Analytics Logging**: Executions of blocking rules are logged to the Workers Analytics Engine for monitoring and analysis.

## How it Works

1.  The worker (`src/index.ts`) intercepts incoming HTTP requests.
2.  It fetches a list of filtering rules from the `FILTER_RULES_KV` namespace. The rules are expected to be stored as a JSON array under the key `FILTERING_RULES`.
3.  Each rule is evaluated against the current request.
4.  If a rule matches and its action is `block`, the request is immediately denied with a `403 Forbidden` response.
5.  Details of the blocked request and the triggering rule are sent to the `RULE_ANALYTICS` Workers Analytics Engine dataset.
6.  If no rule blocks the request, it is allowed to proceed (currently returns "Hello World! Request allowed.").

## Setup and Deployment

### Prerequisites

- A Cloudflare account.
- Node.js and npm installed.
- Wrangler CLI installed (`npm install -g wrangler`).

### Configuration

1.  **Clone the Repository (if applicable)**
    ```bash
    # git clone <repository-url>
    # cd dynamic-filter-example
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Configure `wrangler.jsonc`**
    This file contains the configuration for your worker, including bindings.
    - **`kv_namespaces`**:
        - The `FILTER_RULES_KV` binding is already defined. You need to ensure the `id` in `wrangler.jsonc` matches your KV namespace ID.
        - If you don't have a KV namespace yet, create one:
          ```bash
          npx wrangler kv:namespace create FILTER_RULES_KV
          ```
        - Copy the `id` from the output and paste it into the `id` field for `FILTER_RULES_KV` in `wrangler.jsonc`.
    - **`analytics_engine_datasets`**:
        - The `RULE_ANALYTICS` binding is configured to use a dataset named `rule_executions`. This dataset will be created automatically when the worker first writes to it.

    Your `wrangler.jsonc` should look similar to this for the bindings:
    ```json
    // ... other wrangler.jsonc configurations ...
      "kv_namespaces": [
        {
          "binding": "FILTER_RULES_KV",
          "id": "<YOUR_KV_NAMESPACE_ID_HERE>" // Replace with your actual KV namespace ID
        }
      ],
    "analytics_engine_datasets": [
        { "binding": "RULE_ANALYTICS", "dataset": "rule_executions" }
    ]
    // ... other wrangler.jsonc configurations ...
    ```

4.  **Add Filtering Rules to KV**

    Filtering rules are defined as a JSON array. An example set of rules is provided in `rules.json` in this repository.

    To add rules to your KV namespace:
    - **Using the Cloudflare Dashboard:**
        1.  Navigate to your Cloudflare account.
        2.  Go to "Workers & Pages" > "KV".
        3.  Select your `FILTER_RULES_KV` namespace (or the name you gave it if different, matching the `id` in `wrangler.jsonc`).
        4.  Click "Add entry".
        5.  For "Key", enter `FILTERING_RULES`.
        6.  For "Value", paste the JSON array of your rules.
        7.  Click "Save".
    - **Using Wrangler CLI:**
        1.  Ensure your `rules.json` file (or a similar file with your rules) is in your project directory.
        2.  Run the following command, replacing `<YOUR_KV_NAMESPACE_ID_HERE>` with the ID of your `FILTER_RULES_KV` namespace:
            ```bash
            # Ensure CLOUDFLARE_API_TOKEN is set if you encounter auth issues
            # export CLOUDFLARE_API_TOKEN="your_api_token_here" 
            npx wrangler kv:key put --namespace-id="<YOUR_KV_NAMESPACE_ID_HERE>" "FILTERING_RULES" --path="./rules.json"
            ```
            If you get an authentication error (like "PUT method not allowed for the oauth_token authentication scheme"), you may need to create and use a Cloudflare API Token with `Workers KV Storage:Edit` permissions. Set it as an environment variable `CLOUDFLARE_API_TOKEN` before running the command.

### Deployment

1.  **Build and Deploy the Worker**
    ```bash
    npm run deploy
    ```
    This command will build your worker and deploy it to Cloudflare.

## Viewing Analytics

Once your worker is deployed and has processed requests that trigger blocking rules:
1.  Go to your Cloudflare Dashboard.
2.  Navigate to "Workers & Pages".
3.  Select the "Analytics Engine" tab.
4.  You should find a dataset named `rule_executions` (or the name you configured).
5.  You can query this dataset to see which rules are being triggered, request details, and timestamps. For example, you can query by the indexed `rule_id`.

### Example Analytics Engine Queries

Once your `rule_executions` dataset is populated, you can run SQL queries against it in the Cloudflare Dashboard (Workers & Pages > Analytics Engine > `rule_executions` dataset > Query).

Here are some example queries to get you started:

**1. Total Executions Per Rule ID**

This query shows the total number of times each rule has been triggered and resulted in a block. `index1` corresponds to `rule.id` and `double1` corresponds to the count.

```sql
SELECT
    index1 AS rule_id,
    SUM(double1) AS total_executions
FROM rule_executions
GROUP BY rule_id
ORDER BY total_executions DESC
```

**2. Top 5 Most Triggered Rules in the Last 24 Hours**

This helps identify which rules are currently most active.

```sql
SELECT
    index1 AS rule_id,
    SUM(double1) AS recent_executions
FROM rule_executions
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY rule_id
ORDER BY recent_executions DESC
LIMIT 5
```

**3. Daily Execution Count for a Specific Rule**

Replace `'your-specific-rule-id'` with the actual ID of the rule you want to track.

```sql
SELECT
    CAST(timestamp AS DATE) AS execution_day,
    SUM(double1) AS daily_executions
FROM rule_executions
WHERE index1 = 'your-specific-rule-id'
GROUP BY execution_day
ORDER BY execution_day DESC
```

**4. Count of Unique User-Agents Blocked by a Specific Rule (Last 7 Days)**

This can help understand the variety of clients being blocked by a particular rule. `blob3` corresponds to the User-Agent in the `writeDataPoint` call.

```sql
SELECT
    index1 AS rule_id,
    COUNT(DISTINCT blob3) AS unique_user_agents
FROM rule_executions
WHERE index1 = 'your-specific-rule-id' AND timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY rule_id
```

**5. Count of Unique IP Addresses Blocked by a Specific Rule (Last 7 Days)**

This shows how many different IP addresses were blocked by a rule. `blob4` corresponds to the `CF-Connecting-IP`.

```sql
SELECT
    index1 AS rule_id,
    COUNT(DISTINCT blob4) AS unique_ips
FROM rule_executions
WHERE index1 = 'your-specific-rule-id' AND timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY rule_id
```

**6. URLs Blocked by a Specific Rule (Last Hour, with counts)**

See which URLs are most frequently blocked by a specific rule. `blob1` corresponds to the request URL.

```sql
SELECT
    blob1 AS blocked_url,
    SUM(double1) AS times_blocked
FROM rule_executions
WHERE index1 = 'your-specific-rule-id' AND timestamp >= NOW() - INTERVAL '1' HOUR
GROUP BY blocked_url
ORDER BY times_blocked DESC
```

**Notes on Querying:**

*   The `rule_executions` table has columns like `timestamp`, `index1` (for `rule_id` from `indexes[0]`), `double1` (for the count from `doubles[0]`), and `blob1` through `blobN` for the blob array.
*   Refer to the order of blobs in your `writeDataPoint` call in `src/index.ts` to know which `blob` field corresponds to which piece of information:
    *   `blob1`: Request URL
    *   `blob2`: Rule Description
    *   `blob3`: User-Agent
    *   `blob4`: CF-Connecting-IP
    *   `blob5`: ISO Timestamp string
*   The `NOW()` function and `INTERVAL` syntax are common in SQL-like query languages for time windowing. Check the specific syntax supported by Cloudflare Analytics Engine if needed.

## Rule Structure

Each rule in the JSON array should follow this structure:

```json
{
  "id": "string",         // Unique identifier for the rule
  "description": "string",// Description of what the rule does
  "target": "header" | "url" | "method", // What part of the request to inspect
  "property": "string" (optional), // Specific property of the target (e.g., header name, 'pathname' for URL)
  "condition": "equals" | "contains" | "startsWith" | "endsWith" | "exists", // How to evaluate the subject
  "value": "string" (optional), // Value to check against (not used for "exists" on headers if only checking presence)
  "action": "block"       // Currently only "block" is supported
}
```

**Examples:**

-   **Block a specific User-Agent:**
    ```json
    {
      "id": "block-bad-bot",
      "description": "Block requests from BadBot/1.0",
      "target": "header",
      "property": "User-Agent",
      "condition": "equals",
      "value": "BadBot/1.0",
      "action": "block"
    }
    ```
-   **Block access to an admin path:**
    ```json
    {
      "id": "block-admin-path",
      "description": "Block access to /admin",
      "target": "url",
      "property": "pathname",
      "condition": "startsWith",
      "value": "/admin",
      "action": "block"
    }
    ```
-   **Block if a specific header exists:**
    ```json
    {
      "id": "block-exploit-header",
      "description": "Block if X-Exploit-Header is present",
      "target": "header",
      "property": "X-Exploit-Header",
      "condition": "exists",
      "action": "block"
    }
    ```

## Local Development

To run the worker locally for development and testing:
```bash
npm run dev
```
This will start a local server, typically at `http://localhost:8787`. You will need to configure local KV and Analytics Engine bindings if you want to test those features locally (e.g., by adding them to your `wrangler.jsonc` for local use or using Miniflare options).

For KV, you can create a local KV namespace for testing:
```bash
npx wrangler kv:namespace create FILTER_RULES_KV --preview
```
And then add its `preview_id` to `wrangler.jsonc` under a `[env.dev.kv_namespaces]` section or similar for local testing.
