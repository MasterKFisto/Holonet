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

export interface HealthResponse {
  ok: boolean;
  service: string;
  version?: string;
  uptimeSeconds?: number;
}
