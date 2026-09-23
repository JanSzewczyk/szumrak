# Code Style

Conventions for writing code in this project.

## Function declarations

Always use the `function` keyword to define functions. Never use arrow function expressions for named functions.

```typescript
// ✓
function handleSubmit(data: FormData) {
  // ...
}

function formatDate(date: Date): string {
  return date.toISOString();
}

// ✗
const handleSubmit = (data: FormData) => {
  // ...
};

const formatDate = (date: Date): string => date.toISOString();
```

Inline arrow functions are allowed only where a callback is expected (e.g. `array.map`, `array.filter`, event handlers passed as JSX props).

```typescript
// ✓ — inline callback
const sorted = steps.sort((a, b) => a.orderIndex - b.orderIndex);
```

### Function types in object types

Use method signature syntax instead of arrow function property types.

```typescript
// ✓
type ProjectSidebarProps = {
  onUpdateStatusAction(projectId: string, newStatus: ProjectStatus): ActionResponse<void>;
  onDeleteAction(projectId: string): RedirectAction;
};

// ✗
type ProjectSidebarProps = {
  onUpdateStatusAction: (projectId: string, newStatus: ProjectStatus) => ActionResponse<void>;
  onDeleteAction: (projectId: string) => RedirectAction;
};
```

## React import

Always import React as a namespace: `import * as React from "react"`. Access all React exports through the namespace (e.g. `React.cache`, `React.useState`, `React.useEffect`). Never use default import and never import React members as named imports.

```typescript
// ✓
import * as React from "react";

React.cache(fn);
React.useState(0);
React.useEffect(() => { ... }, []);

// ✗
import React from "react";
import React, { cache, useState } from "react";
import { cache } from "react";
```

## Array types in TypeScript

Always use the generic form `Array<Type>` instead of the shorthand notation `Type[]`.

```typescript
// ✓
Array<string>
Array<ProjectStep>
Array<{ id: string; name: string }>

// ✗
string[]
ProjectStep[]
{ id: string; name: string }[]
```

Applies to all contexts: component props, function signatures, variable types, return types.

## Conditional rendering

Always use the ternary operator for conditional rendering. Never use `&&` short-circuit.

```tsx
// ✓
{condition ? <Component /> : null}

// ✗
{condition && <Component />}
```

**Why:** `&&` with falsy non-boolean values (e.g. `0`, `""`) renders the value itself instead of nothing. The ternary is always explicit and safe.

This applies to all conditional expressions in JSX — single elements, fragments, and inline text.

```tsx
// ✓
{items.length > 0 ? <List items={items} /> : null}
{error ? <p className="text-error">{error}</p> : null}
{isActive ? "Active" : null}

// ✗
{items.length > 0 && <List items={items} />}
{error && <p className="text-error">{error}</p>}
```

## Enum const objects

Model a closed set of string values as an **enum const object**: a `const` object literal with `as const`, plus a type of the **same name** derived from its values. Never use a TypeScript `enum` or a hand-written string-literal union. Keys are `UPPER_SNAKE_CASE`, values are the actual runtime strings.

```typescript
// ✓
export const OrderStatus = {
  PENDING: "pending",
  PAID: "paid",
  SHIPPED: "shipped",
  CANCELLED: "cancelled"
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

// ✗
enum OrderStatus { PENDING = "pending", PAID = "paid", SHIPPED = "shipped", CANCELLED = "cancelled" }
type OrderStatus = "pending" | "paid" | "shipped" | "cancelled";
```

A single `OrderStatus` import then serves as both the value (`OrderStatus.PAID`) and the type (`OrderStatus`). Always go through the const object's properties — in comparisons, record keys, schemas, and narrowed types (`Extract<OrderStatus, typeof OrderStatus.X>`). Never use raw string literals.

```typescript
// ✓
if (order.status === OrderStatus.PAID) { ... }
const STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: "Awaiting payment",
  [OrderStatus.PAID]: "Paid",
  [OrderStatus.SHIPPED]: "On its way",
  [OrderStatus.CANCELLED]: "Cancelled"
};
status: z.enum([OrderStatus.PENDING, OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.CANCELLED])
nextStatus: Extract<OrderStatus, typeof OrderStatus.SHIPPED | typeof OrderStatus.CANCELLED>

// ✗
if (order.status === "paid") { ... }
const STATUS_LABELS = { pending: "Awaiting payment", paid: "Paid" };
status: z.enum(["pending", "paid", "shipped", "cancelled"])
nextStatus: Extract<OrderStatus, "shipped" | "cancelled">
```

**Why:** the const object is the single source of truth — renaming or adding a value happens in one place, `Record<EnumType, ...>` turns a missed entry into a compile error, and unlike a TS `enum` it emits no extra runtime code and stays structurally compatible with plain strings coming from env vars, JSON, or an API.

## Comments

When a comment is warranted, always use JSDoc format (`/** ... */`), even for a single-line comment above a function, type, or non-obvious statement. Never use plain `//` comments for documentation purposes.
This does not change *when* to comment — default to no comments; only write one when the WHY is non-obvious (a hidden constraint, a subtle invariant, a workaround). It only changes the *format* once a comment is warranted.

## List keys in `map`

Never use the array index as the `key` of components rendered inside `map`. Always use a stable, unique value derived from the data (e.g. an `id`).

```tsx
// ✓
{items.map((item) => (
  <Item key={item.id} item={item} />
))}

{entries.map((entry) => (
  <Entry key={entry.slug} entry={entry} />
))}

// ✗
{items.map((item, index) => (
  <Item key={index} item={item} />
))}
```

**Why:** index keys break React's reconciliation when the list is reordered, filtered, or has items inserted/removed — leading to stale state, wrong DOM reuse, and subtle rendering bugs. If the data has no natural unique field, derive a stable key from its contents or attach a generated id when the data is created — never fall back to the index.
