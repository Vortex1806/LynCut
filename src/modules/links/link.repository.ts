import { prisma } from "../../infra/prisma.js";

export async function createLink(data: {
  userId: string;
  shortCode: string;
  targetUrl: string;
}) {
  return prisma.link.create({
    data: data,
  });
}

export async function findByShortCode(shortCode: string) {
  return prisma.link.findUnique({
    select: { shortCode: true, targetUrl: true, isActive: true },
    where: { shortCode },
  });
}

export async function listByUser(
  userId: string,
  { limit = 20, cursor }: { limit?: number; cursor?: string },
) {
  const links = await prisma.link.findMany({
    where: { userId },
    take: limit + 1,
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1,
    }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const hasMore = links.length > limit;
  const items = hasMore ? links.slice(0, limit) : links;
  const lastItem = items.at(-1);

  return {
    items,
    nextCursor: hasMore && lastItem ? lastItem.id : null,
  };
}

export async function updateLink(data: {
  userId: string;
  shortCode: string;
  targetUrl: string;
}) {
  return prisma.link.update({
    data: { targetUrl: data.targetUrl },
    where: { userId: data.userId, shortCode: data.shortCode },
  });
}

export async function deleteLink(data: { userId: string; shortCode: string }) {
  return prisma.link.delete({
    where: { userId: data.userId, shortCode: data.shortCode },
  });
}

export async function setActive(data: {
  userId: string;
  shortCode: string;
  isActive: boolean;
}) {
  return prisma.link.update({
    data: { isActive: data.isActive },
    where: { userId: data.userId, shortCode: data.shortCode },
  });
}
