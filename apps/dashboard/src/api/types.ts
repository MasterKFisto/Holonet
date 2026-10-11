/** API response types (mirror apps/api route responses). */

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'member';
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Membership role of the current user (from the list endpoint). */
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
}

export interface Site {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  templateVersionId: string | null;
  primaryDomainId: string | null;
  settings: Record<string, unknown>;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormFieldDefinition {
  name: string;
  label: string;
  type: 'text' | 'email' | 'textarea' | 'select' | 'checkbox' | 'file';
  required?: boolean;
  options?: string[];
}

export interface Form {
  id: string;
  siteId: string;
  workspaceId: string;
  name: string;
  status: 'active' | 'disabled';
  fields: FormFieldDefinition[];
  notificationEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormSubmission {
  id: string;
  formId: string;
  workspaceId: string;
  /** Untrusted visitor data — always treat as plain text when rendering. */
  data: Record<string, unknown>;
  ipHash: string | null;
  status: 'new' | 'read' | 'archived' | 'spam';
  createdAt: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version?: string;
  uptimeSeconds?: number;
}
