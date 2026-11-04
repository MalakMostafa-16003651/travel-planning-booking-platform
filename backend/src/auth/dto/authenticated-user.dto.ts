import { RegisteredUserDto } from './registered-user.dto';

// Login and current-identity responses use the same public-field allowlist as registration.
export class AuthenticatedUserDto extends RegisteredUserDto {}
