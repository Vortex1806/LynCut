import { prisma } from "../../infra/prisma.js";

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email },
  });
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id: id },
  });
}

export async function createUser(data: {
  name: string;
  email: string;
  passwordHash: string;
}) {
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: data.passwordHash,
    },
  });
}
