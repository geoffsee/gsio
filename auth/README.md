# Geoff CLI

Command-line interface for authenticating with geoff.seemueller.io and accessing v1 API endpoints.

## Features

- Authenticate to geoff.seemueller.io and generate long-lived API keys
- Secure credential storage in `~/.config/geoff-cli/config.json`
- Manage API keys (list, revoke)
- Configure custom base URLs for development/testing

## Installation

### From source:

```bash
# Make the script executable
chmod +x cli/geoff.ts

# Create a symlink to use it globally (optional)
ln -s $(pwd)/cli/geoff.ts /usr/local/bin/geoff
```

### Using bun:

```bash
bun install
```

## Usage

### Authentication

```bash
# Login and generate an API key
geoff auth login

# Check authentication status
geoff auth status

# Logout (remove stored credentials)
geoff auth logout
```

### API Key Management

```bash
# List all your API keys
geoff keys list

# Revoke an API key
geoff keys revoke <key-id>
```

### Configuration

```bash
# Set a custom base URL (e.g., for local development)
geoff config set-url http://localhost:8787

# Reset to default URL
geoff config set-url https://geoff.seemueller.io
```

### Other Commands

```bash
# Show version
geoff version

# Show help
geoff help
```

## Authentication Flow

1. The CLI prompts for your email/username and password
2. It authenticates with the server using `/api/login`
3. Upon successful authentication, it generates a new API key via `/api/keys/generate`
4. The API key is stored locally in `~/.config/geoff-cli/config.json`
5. The API key is used for all subsequent requests to v1 endpoints

## API Key Format

API keys use the format: `sk-cli-{uuid}-{secret}`

- Keys are long-lived (default: 90 days)
- Keys can be revoked at any time via the CLI or API
- Each key tracks when it was created and last used

## Security

- API keys are stored in plain text in `~/.config/geoff-cli/config.json`
- Ensure this file has appropriate permissions (should be readable only by you)
- Never commit your config file to version control
- Revoke compromised keys immediately using `geoff keys revoke <id>`

## Using the API Key

Once authenticated, use your API key with the v1 endpoints:

```bash
# Example: List available models
curl https://geoff.seemueller.io/v1/models \
  -H "Authorization: Bearer $(cat ~/.config/geoff-cli/config.json | jq -r .apiKey)"

# Example: Create a chat completion
curl https://geoff.seemueller.io/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

## Development

The CLI is built with Bun and TypeScript. It includes:

- Interactive password input (hidden characters)
- Configuration management
- Error handling and validation
- OpenAI-compatible API integration

## Troubleshooting

### "Not authenticated" errors

Run `geoff auth status` to check if you're logged in. If not, run `geoff auth login`.

### Connection errors

Verify the base URL is correct with `geoff auth status`. You can change it with `geoff config set-url <url>`.

### Invalid API key

Your key may have expired or been revoked. Generate a new one with `geoff auth login`.

## API Endpoints

The following v1 endpoints require API key authentication:

- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Create chat completion (streaming & non-streaming)
- `POST /v1/responses` - Alias for chat completions

## Examples

### Full authentication flow

```bash
$ geoff auth login
Authenticating to https://geoff.seemueller.io...

Email or username: user@example.com
Password: ********

Authenticating...
Generating API key...

✓ Authentication successful!
API Key: sk-cli-abc123-def456...

Your API key has been saved to: /Users/you/.config/geoff-cli/config.json

⚠️  Keep this key secure and do not share it with others.

Key expires: 2/1/2025
```

### List API keys

```bash
$ geoff keys list

Your API Keys:

ID: abc123
Name: cli-2024-11-02
Created: 11/2/2024, 10:30:00 AM
Last Used: 11/2/2024, 11:45:00 AM
Expires: 2/1/2025, 10:30:00 AM

ID: def456
Name: cli-2024-10-15
Created: 10/15/2024, 9:00:00 AM
Expires: 1/15/2025, 9:00:00 AM
```

### Revoke a key

```bash
$ geoff keys revoke abc123
✓ API key revoked successfully
```

## License

MIT