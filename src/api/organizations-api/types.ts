export enum OrganizationMemberRole {
  Admin = 'Admin',
  Member = 'Member',
  Client = 'Client',
}

export type CreateUserResponse = {
  nvmApiKey: string
  userId: string
  userWallet: string
  alreadyMember: boolean
}

export type OrganizationMember = {
  createdAt: string
  updatedAt: string
  id: string
  userId: string
  orgId: string
  userAddress: string
  role: OrganizationMemberRole
  isActive: boolean
}

export type OrganizationMembersResponse = {
  members: OrganizationMember[]
  total: number
}
