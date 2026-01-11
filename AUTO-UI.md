# Auto-UI System

The Auto-UI system automatically generates UI components based on data structure introspection and JSDoc hints. This allows `.photon.ts` files to return raw data without worrying about presentation.

## Features

### 1. **Automatic Format Detection**

The system automatically detects the best UI component based on data structure:

```typescript
// Returns: string → Renders as text
async getMessage(): Promise<string> {
  return "Hello, World!";
}

// Returns: number → Renders as formatted number
async getCount(): Promise<number> {
  return 42;
}

// Returns: Array<string> → Renders as bullet list
async getTags(): Promise<string[]> {
  return ["javascript", "typescript", "nodejs"];
}

// Returns: Flat object → Renders as bordered table
async getUser(): Promise<{ name: string; email: string }> {
  return { name: "John", email: "john@example.com" };
}

// Returns: Array of flat objects → Renders as data table
async getUsers(): Promise<Array<{ name: string; age: number }>> {
  return [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
  ];
}

// Returns: Nested object → Renders as tree
async getConfig(): Promise<any> {
  return {
    server: {
      host: "localhost",
      port: 3000,
    },
    database: {
      url: "postgresql://...",
    },
  };
}
```

### 2. **JSDoc Format Hints**

Override automatic detection with explicit format hints:

```typescript
/**
 * Get status information
 * @format table
 */
async getStatus(): Promise<any> {
  return { status: "running", uptime: 3600, connections: 42 };
}

/**
 * Get code snippet
 * @format code:typescript
 */
async getExample(): Promise<string> {
  return `
    function hello(name: string) {
      console.log("Hello, " + name);
    }
  `;
}

/**
 * Get documentation
 * @format markdown
 */
async getDocs(): Promise<string> {
  return `
    # Getting Started
    
    This is **markdown** content with:
    - Bullet points
    - Code blocks
    - And more
  `;
}

/**
 * Get configuration
 * @format json
 */
async getConfig(): Promise<string> {
  return JSON.stringify({ key: "value" }, null, 2);
}
```

### 3. **UI Component Hints**

Request specific UI components:

```typescript
/**
 * Get user profile
 * @ui-component card
 * @ui-title User Profile
 */
async getProfile(): Promise<any> {
  return {
    name: "Alice",
    email: "alice@example.com",
    bio: "Software engineer...",
    interests: ["coding", "reading"],
  };
}

/**
 * Get metrics
 * @ui-component chart
 */
async getMetrics(): Promise<Array<{ label: string; value: number }>> {
  return [
    { label: "Users", value: 1000 },
    { label: "Sessions", value: 5000 },
    { label: "Errors", value: 10 },
  ];
}

/**
 * Get progress
 * @ui-component progress
 */
async getProgress(): Promise<{ value: number; total: number }> {
  return { value: 75, total: 100 };
}

/**
 * Get navigation
 * @ui-component tabs
 * @ui-layout tabs
 */
async getNavigation(): Promise<any> {
  return {
    Overview: { status: "active", items: 10 },
    Settings: { theme: "dark", language: "en" },
    Help: { docs: "https://..." },
  };
}

/**
 * Get FAQ
 * @ui-component accordion
 */
async getFAQ(): Promise<Array<{ title: string; content: string }>> {
  return [
    { title: "What is Photon?", content: "Photon is..." },
    { title: "How do I install?", content: "Run npm install..." },
  ];
}
```

### 4. **Interactive Components**

Enable interactivity for web UIs:

```typescript
/**
 * Search items
 * @ui-component table
 * @ui-interactive
 */
async searchItems(query: string): Promise<any[]> {
  // Table will be searchable/sortable in web UI
  return await db.search(query);
}
```

### 5. **Layout Control**

Control how components are arranged:

```typescript
/**
 * Get dashboard data
 * @ui-layout grid
 */
async getDashboard(): Promise<any> {
  return [
    { title: "Users", value: 1000 },
    { title: "Revenue", value: "$50k" },
    { title: "Growth", value: "+12%" },
  ];
}

/**
 * Get timeline
 * @ui-layout stack
 */
async getTimeline(): Promise<any[]> {
  return [
    { date: "2024-01-01", event: "Project started" },
    { date: "2024-01-15", event: "First release" },
  ];
}
```

## Supported Components

### Basic Components
- **text**: Plain text display
- **number**: Formatted numbers
- **boolean**: Yes/no indicators
- **list**: Bullet point lists
- **table**: Data tables with borders
- **tree**: Hierarchical data

### Advanced Components
- **card**: Rich content cards
- **chart**: ASCII bar charts (CLI) / interactive charts (Web)
- **progress**: Progress bars
- **code**: Syntax-highlighted code
- **markdown**: Formatted markdown
- **json**: Pretty-printed JSON
- **form**: Form field display
- **tabs**: Tabbed content
- **accordion**: Collapsible sections

## Supported Formats

### Structural Formats
- `primitive`: Single values (auto-detected)
- `list`: Arrays of primitives
- `table`: Flat objects or arrays of flat objects
- `tree`: Nested/hierarchical structures
- `none`: No data to display

### Content Formats
- `json`: Pretty-printed JSON
- `markdown`: Rendered markdown
- `yaml`: YAML content
- `xml`/`html`: XML/HTML content
- `code`: Generic code
- `code:<lang>`: Language-specific code (e.g., `code:typescript`, `code:python`)

## How It Works

1. **Data Returned**: Your `.photon.ts` method returns raw data
2. **Hints Extracted**: System reads JSDoc comments for hints
3. **Format Detection**: If no hints, system introspects data structure
4. **Component Generation**: Appropriate UI component is generated
5. **Rendering**: Component is rendered for target platform (CLI/MCP/Web)

## Benefits

✅ **Zero boilerplate**: Just return data, UI is automatic  
✅ **Consistent**: Same data structure = same UI everywhere  
✅ **Flexible**: Override with hints when needed  
✅ **Multi-platform**: Works in CLI, MCP, and Web UIs  
✅ **Extensible**: Add custom components and renderers  

## Examples

### Before (Manual Formatting)
```typescript
async getStatus() {
  const data = await fetchStatus();
  // Manual formatting required
  return `
Status: ${data.status}
Uptime: ${data.uptime}
Users: ${data.users}
  `;
}
```

### After (Auto-UI)
```typescript
/**
 * Get system status
 * @format table
 */
async getStatus() {
  return await fetchStatus(); // Returns { status, uptime, users }
}
```

The table is automatically generated with borders, aligned columns, and proper formatting!

## Architecture

```
┌─────────────────┐
│ .photon.ts file │ Returns raw data
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Auto-UI Core   │ Detects format + generates component
└────────┬────────┘
         │
         ├─────────┬─────────┬─────────┐
         ▼         ▼         ▼         ▼
    ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
    │ CLI  │  │ MCP  │  │ Web  │  │ API  │
    └──────┘  └──────┘  └──────┘  └──────┘
    Terminal  Claude    Browser   REST
```

## Future Enhancements

- [ ] Custom component registry
- [ ] Theme support
- [ ] Animation hints (@ui-animate)
- [ ] Pagination hints (@ui-paginate)
- [ ] Export hints (@ui-export csv,json)
- [ ] Validation hints (@ui-validate)
- [ ] Real-time updates (@ui-realtime)
