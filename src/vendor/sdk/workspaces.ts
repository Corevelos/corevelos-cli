/** Human workspace management. Authorization stays in the platform routes. */
import { z } from 'zod'
import * as c from './contract/index.js'
import { CorevelosClient } from './client.js'
const accepted = z.object({ accepted: z.literal(true) })
const id = (value: string) => {
  if (!value || value === '.' || value === '..') throw new Error('Resource id must be a nonempty path segment.')
  return encodeURIComponent(value)
}
const projectIdPath = (value: string) => id(c.ProjectIdSchema.parse(value))
export class Projects {
  constructor(private readonly client: CorevelosClient) {}
  workspaces() {
    return this.client.request(c.ListWorkspacesResponseSchema, { path: '/api/v1/projects/workspaces' })
  }
  list() {
    return this.client.request(c.ListProjectsResponseSchema, { path: '/api/v1/projects' })
  }
  get(projectId: string) {
    return this.client.request(c.ProjectSchema, { path: `/api/v1/projects/${projectIdPath(projectId)}` })
  }
  create(input: c.CreateProjectBody) {
    return this.client.request(c.ProjectSchema, {
      method: 'POST',
      path: '/api/v1/projects',
      body: c.CreateProjectBodySchema.parse(input),
    })
  }
  update(projectId: string, input: c.UpdateProjectBody) {
    return this.client.request(c.ProjectSchema, {
      method: 'PATCH',
      path: `/api/v1/projects/${projectIdPath(projectId)}`,
      body: c.UpdateProjectBodySchema.parse(input),
    })
  }
  archive(projectId: string) {
    return this.client.request(c.ProjectSchema, {
      method: 'POST',
      path: `/api/v1/projects/${projectIdPath(projectId)}/archive`,
    })
  }
  usage(projectId: string) {
    return this.client.request(c.UsageSummarySchema, { path: `/api/v1/projects/${projectIdPath(projectId)}/usage` })
  }
  members(projectId: string) {
    return this.client.request(c.ListProjectMembersResponseSchema, {
      path: `/api/v1/projects/${projectIdPath(projectId)}/members`,
    })
  }
  addMember(projectId: string, input: c.AddProjectMemberBodyInput) {
    return this.client.request(c.ProjectMemberSchema, {
      method: 'POST',
      path: `/api/v1/projects/${projectIdPath(projectId)}/members`,
      body: c.AddProjectMemberBodySchema.parse(input),
    })
  }
  removeMember(projectId: string, userId: string) {
    return this.client.request(accepted, {
      method: 'DELETE',
      path: `/api/v1/projects/${projectIdPath(projectId)}/members/${id(userId)}`,
    })
  }
}
export class Organizations {
  constructor(private readonly client: CorevelosClient) {}
  leave(runningSandboxes: 'keep' | 'terminate' = 'keep') {
    return this.client.request(accepted, {
      method: 'DELETE',
      path: '/api/v1/organizations/current/membership',
      query: { runningSandboxes },
    })
  }
  transfer(input: c.TransferOrganizationOwnershipBody) {
    return this.client.request(accepted, {
      method: 'POST',
      path: '/api/v1/organizations/current/ownership',
      body: c.TransferOrganizationOwnershipBodySchema.parse(input),
    })
  }
  plan() {
    return this.client.request(c.AccountPlanSchema, { path: '/api/v1/organizations/plan' })
  }
  current() {
    return this.client.request(c.OrganizationContextSchema, { path: '/api/v1/organizations/current' })
  }
  create(name: string) {
    return this.client.request(c.OrganizationContextSchema, {
      method: 'POST',
      path: '/api/v1/organizations',
      body: c.CreateOrganizationBodySchema.parse({ name }),
    })
  }
  rename(name: string) {
    return this.client.request(c.OrganizationContextSchema, {
      method: 'PATCH',
      path: '/api/v1/organizations/current',
      body: c.UpdateOrganizationBodySchema.parse({ name }),
    })
  }
  members(query: { limit?: number; after?: string } = {}) {
    return this.client.request(c.ListOrganizationMembersResponseSchema, {
      path: '/api/v1/organizations/current/members',
      query: c.OrganizationPageQuerySchema.parse(query),
    })
  }
  invitations(query: { limit?: number; after?: string } = {}) {
    return this.client.request(c.ListOrganizationInvitationsResponseSchema, {
      path: '/api/v1/organizations/current/invitations',
      query: c.OrganizationPageQuerySchema.parse(query),
    })
  }
  invite(input: c.SendOrganizationInvitationBody) {
    return this.client.request(c.OrganizationInvitationSchema, {
      method: 'POST',
      path: '/api/v1/organizations/current/invitations',
      body: c.SendOrganizationInvitationBodySchema.parse(input),
    })
  }
  revokeInvitation(invitationId: string) {
    return this.client.request(c.OrganizationInvitationSchema, {
      method: 'DELETE',
      path: `/api/v1/organizations/current/invitations/${id(c.OrganizationInvitationIdParamsSchema.parse({ invitationId }).invitationId)}`,
    })
  }
  setRole(membershipId: string, input: c.UpdateOrganizationMemberBody) {
    return this.client.request(c.OrganizationMemberSchema, {
      method: 'PATCH',
      path: `/api/v1/organizations/current/members/${id(c.OrganizationMembershipIdParamsSchema.parse({ membershipId }).membershipId)}`,
      body: c.UpdateOrganizationMemberBodySchema.parse(input),
    })
  }
  removeMember(membershipId: string, runningSandboxes: 'keep' | 'terminate' = 'keep') {
    return this.client.request(accepted, {
      method: 'DELETE',
      path: `/api/v1/organizations/current/members/${id(c.OrganizationMembershipIdParamsSchema.parse({ membershipId }).membershipId)}`,
      query: { runningSandboxes },
    })
  }
}
