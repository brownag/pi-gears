# pi-gears

Transmission system for [Pi](https://pi.dev/) ([GitHub](https://github.com/earendil-works/pi-coding-agent)). Shifts model reasoning and hardware targets on the fly.

## Why?

Reasoning models waste time when editing files or running bash commands, but skipping reasoning during architectural planning or review can lead to shallow plans, missed steps, or bugs.

`pi-gears` maps model endpoints to gears in a transmission, allowing you to "shift" easily between different model configurations and hardware.

- **Gear 1 (`plan`)**: Thinking on (`temp: 0.6`, `chat_template_kwargs.enable_thinking: true`). For architecture, debugging, and task planning.
- **Gear 2 (`exec`)**: Thinking off (`temp: 0.1`, `chat_template_kwargs.enable_thinking: false`). Fast, deterministic tool calls and code edits.
- **Gear 3 & 4**: Secondary hardware targets (CPU RAM, remote boxes, or smaller models).

## Getting Started

The extension requires an explicit `gears.json` file to function. Here's the step-by-step customization flow:

### Step 1: Define Providers in `models.json`

First, ensure your Pi installation has one or more providers configured in `models.json`. See [Pi documentation](https://pi.dev/docs/providers) for defining providers with your preferred models.

Example provider configurations:
- `gpu`: A model optimized for your GPU (e.g., an A100 with Qwen or Claude)
- `cpu`: A model optimized for CPU-only execution (smaller model or local llama.cpp instance)
- `local-llm`: A local model server (llama.cpp, vLLM, Ollama)

### Step 2: Install pi-gears

Install the extension globally or to a specific project:

```bash
# Global install (symlinked for development)
npx tsx install.ts --global --symlink

# Or project-local install
npx tsx install.ts --project /path/to/your/project --symlink

# Preview changes without writing
npx tsx install.ts --dry-run
```

The installer merges model definitions into `models.json` and deploys the extension files.

### Step 3: Copy and Customize `gears.example.json`

Copy the generic example to create your personal configuration:

```bash
# Copy to global Pi agent directory
cp gears.example.json ~/.pi/agent/gears.json

# Or copy to your project's `.pi/` directory
cp gears.example.json .pi/gears.json
```

Then edit `gears.json` to match your actual provider and model names:

```json
{
  "gears": [
    {
      "id": 1,
      "name": "gpu-plan",
      "alias": ["plan", "1"],
      "provider": "gpu",              // ← Replace with your actual provider name
      "model": "large-reasoning",     // ← Replace with your actual model name
      "modelId": "gpu/large-reasoning",
      "temperature": 0.6,
      "thinking": true,
      "description": "GPU primary: deep reasoning & architecture"
    },
    // ... continue for other gears ...
  ]
}
```

**Important:** The `gears.example.json` file in the repository remains generic (using placeholder names like `gpu`, `cpu`, `large-reasoning`, `medium-fast`). It is safe to commit. Your personal `gears.json` is in `.gitignore` and will not be tracked by git.

### Step 4: Run `/gear` to Switch Gears

Once configured, use the `/gear` command in Pi to switch between gears:

```bash
/gear 1           # Switch to gear 1 (plan)
/gear plan        # Use alias
/gear             # Show interactive menu
```

Press `Alt+Shift+G` to cycle through gears quickly.

## Controls

Visual cues mark the mode:
- `🧠︎` (think): reasoning enabled
- `🗲︎` (exec): direct execution without reasoning

### Command: `/gear`

- **Interactive menu**: Run `/gear` with no arguments to pick from a list
 
- **Direct shift**: Pass an ID, name, or alias:
  ```bash
  /gear 1           # Gear 1 (GPU plan)
  /gear plan        # Alias for 1
  /gear 2           # Gear 2 (GPU exec)
  /gear exec        # Alias for 2
  /gear 3           # Gear 3 (CPU plan)
  /gear cpu-exec    # Gear 4 (CPU exec)
  ```

- **Autocomplete**: Press `Tab` after `/gear ` to complete IDs, names, and aliases.

### Shortcut: `Alt+Shift+G`

Press `Alt+Shift+G` to cycle through gears. 

### Status Line

Pi's footer shows the active gear:
```
[⚙︎ gear:1:gpu-plan (🧠︎ think)]
```
or
```
[⚙︎ gear:2:gpu-exec (🗲︎ exec)]
```

## Profiles (`gears.json`)

Gear settings live in a JSON file separate from extension code.

### Search Order

Pi checks these paths in order:
1. `~/.pi/agent/gears.json` (global default)
2. `<project_root>/.pi/gears.json` (repo override)
3. `./gears.json` (workspace)

### Fields

- `id`: Gear number (1, 2, 3...)
- `name`: Identifier string
- `alias`: Shorthand strings for `/gear <alias>`
- `provider`: Provider key in `models.json`
- `model`: Model key under that provider
- `modelId`: Full `<provider>/<model>` identifier
- `temperature`: Sampling temperature (e.g. `0.6` for planning, `0.1` for execution)
- `thinking`: `true` sets `chat_template_kwargs.enable_thinking = true`, `false` turns it off
- `description`: Text shown in the `/gear` menu

### Interceptors

Optional: control how gear settings propagate to subagents.

- `interceptors.subagent.enabled`: Enable/disable subagent interceptor
- `interceptors.subagent.propagateModel`: Pass the active gear's model to spawned subagents
- `interceptors.subagent.propagateThinking`: Pass the active gear's thinking setting to spawned subagents
- `interceptors.subagent.preserveExplicitThinking`: Keep explicit thinking overrides in subagent requests (don't override with gear setting)
- `interceptors.subagent.targetAgents`: Array of agent names to apply these settings to (empty = all subagents)

### Default Config (GPU + CPU)

Customize `provider` and `model` to match your setup in `models.json`:

```json
{
  "gears": [
    {
      "id": 1,
      "name": "gpu-plan",
      "alias": ["plan", "1"],
      "provider": "gpu",
      "model": "large-reasoning",
      "modelId": "gpu/large-reasoning",
      "temperature": 0.6,
      "thinking": true,
      "description": "GPU primary: deep reasoning & architecture"
    },
    {
      "id": 2,
      "name": "gpu-exec",
      "alias": ["exec", "2"],
      "provider": "gpu",
      "model": "medium-fast",
      "modelId": "gpu/medium-fast",
      "temperature": 0.1,
      "thinking": false,
      "description": "GPU primary: fast deterministic execution"
    },
    {
      "id": 3,
      "name": "cpu-plan",
      "alias": ["cpu-plan", "3"],
      "provider": "cpu",
      "model": "large-reasoning",
      "modelId": "cpu/large-reasoning",
      "temperature": 0.6,
      "thinking": true,
      "description": "CPU secondary: reasoning with system RAM"
    },
    {
      "id": 4,
      "name": "cpu-exec",
      "alias": ["cpu-exec", "4"],
      "provider": "cpu",
      "model": "medium-fast",
      "modelId": "cpu/medium-fast",
      "temperature": 0.1,
      "thinking": false,
      "description": "CPU secondary: fast execution"
    }
  ]
}
```

### Other Setups (llama.cpp, vLLM, etc.)

1. Add your provider to `models.json`.
2. Write `~/.pi/agent/gears.json`. Example for llama.cpp running on localhost:8001:
   ```json
   {
     "gears": [
       {
         "id": 1,
         "name": "qwen-plan",
         "alias": ["plan", "1"],
         "provider": "local-llm",
         "model": "qwen-35b-mtp",
         "modelId": "local-llm/qwen-35b-mtp",
         "temperature": 0.6,
         "thinking": true,
         "description": "Qwen 35B deep reasoning"
       },
       {
         "id": 2,
         "name": "gemma-exec",
         "alias": ["exec", "2"],
         "provider": "local-llm",
         "model": "gemma4-26b",
         "modelId": "local-llm/gemma4-26b",
         "temperature": 0.1,
         "thinking": false,
         "description": "Gemma 26B fast execution"
       }
     ]
   }
   ```
3. Run `/reload` in Pi.

## Installation

The `install.ts` script merges model entries into `models.json` and deploys the extension files. See the "Getting Started" section above for the complete setup workflow.

```bash
# Preview changes without writing to disk
npx tsx install.ts --dry-run

# Global install (symlinked so repo edits apply immediately)
npx tsx install.ts --global --symlink

# Project-local install (targets <project>/.pi/)
npx tsx install.ts --project /path/to/project --symlink
```

The installer:
- Merges models without dropping existing providers.
- Writes a `models.json.bak` backup file first.
- Copies or symlinks `pi-gears.ts` and `interceptors.ts` to `extensions/`.
- Deploys `gears.example.json` (you then customize to create `gears.json`).

## Tests

```bash
npm test
```

Runs test suite against a mock sandbox in `./test-sandbox/`. Does not touch `~/.pi`.
