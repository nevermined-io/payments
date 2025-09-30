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
