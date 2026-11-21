// backend/src/common/enums/user-role.enum.ts and auth/dto/registered-user.dto.ts
export type UserRole = 'USER' | 'ADMIN' | 'AIRLINE_MODERATOR' | 'HOTEL_MODERATOR';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export interface AuthenticatedUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}
export type LoginResult = AuthenticatedUser | { passwordChangeRequired: true };
