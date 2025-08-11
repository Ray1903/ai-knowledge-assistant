import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

try {
  const ds = await prisma.datasetProfile.findFirst({
    orderBy: { createdAt: "desc" },
    include: { columns: true, document: true },
  });
  console.log(ds ?? { message: "sin perfiles aún" });
} catch (e) {
  console.error(e);
} finally {
  await prisma.$disconnect();
}
