import { ConflictError, UnauthorizedError } from "../../shared/errors.js";
import { createUser, findUserByEmail } from "./auth.repository.js";
import { hash, verify } from "./password.js";
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from "./tokens.js";

type SignAccessToken = (userId: string) => Promise<string>;

export class AuthService {
  constructor(private readonly signAccessToken: SignAccessToken) {}

  async signup(input: { name: string; email: string; password: string }) {
    const existingUser = await findUserByEmail(input.email);
    if (existingUser) {
      throw new ConflictError("Email already registered");
    }

    const passwordHash = await hash(input.password);

    const user = await createUser({
      name: input.name,
      email: input.email,
      passwordHash: passwordHash,
    });

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(user.id),
      issueRefreshToken(user.id),
    ]);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      accessToken,
      refreshToken,
    };
  }

  async login(input: { email: string; password: string }) {
    const user = await findUserByEmail(input.email);

    if (!user || !(await verify(input.password, user.passwordHash))) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(user.id),
      issueRefreshToken(user.id),
    ]);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      accessToken,
      refreshToken,
    };
  }

  async refresh(input: { refreshToken: string }) {
    const rotated = await rotateRefreshToken(input.refreshToken);

    if (!rotated) {
      throw new UnauthorizedError("Invalid refresh token.");
    }

    const accessToken = await this.signAccessToken(rotated.userId);

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(input: { refreshToken: string }) {
    await revokeRefreshToken(input.refreshToken);
  }
}
