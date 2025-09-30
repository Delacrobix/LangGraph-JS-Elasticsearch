import fs from "node:fs/promises";
import { Client } from "@elastic/elasticsearch";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const INDEX_NAME: string = "startups-index";
const ELASTICSEARCH_ENDPOINT: string = process.env.ELASTICSEARCH_ENDPOINT ?? "";
const ELASTICSEARCH_API_KEY: string = process.env.ELASTICSEARCH_API_KEY ?? "";

const esClient = new Client({
  node: ELASTICSEARCH_ENDPOINT,
  auth: {
    apiKey: ELASTICSEARCH_API_KEY,
  },
});

const StartupDocumentSchema = z.object({
  description: z.string(),
  company_name: z.string(),
  industry: z.string(),
  location: z.string(),
  founded_year: z.number(),
  funding_stage: z.string(),
  last_funding_date: z.string(),
  funding_amount: z.number(),
  lead_investor: z.string(),
  other_investors: z.array(z.string()),
  monthly_revenue: z.number(),
  employee_count: z.number(),
  business_model: z.string(),
});

type StartupDocumentType = z.infer<typeof StartupDocumentSchema>;

async function loadDataset(path: string): Promise<StartupDocumentType[]> {
  const raw = await fs.readFile(path, "utf-8");
  const data = JSON.parse(raw);

  return data;
}

async function createIndex() {
  console.log("🔍 Checking if index exists...");
  const indexExists = await esClient.indices.exists({ index: INDEX_NAME });

  if (!indexExists) {
    console.log("🏗️ Creating index...");

    await esClient.indices.create({
      index: INDEX_NAME,
      mappings: {
        properties: {
          description: { type: "text" },
          company_name: { type: "keyword" },
          industry: { type: "keyword" },
          location: { type: "keyword" },
          founded_year: { type: "integer" },
          funding_stage: { type: "keyword" },
          last_funding_date: { type: "date" },
          funding_amount: { type: "long" },
          lead_investor: { type: "keyword" },
          other_investors: { type: "keyword" },
          monthly_revenue: { type: "long" },
          employee_count: { type: "integer" },
          business_model: { type: "keyword" },
        },
      },
    });

    console.log("✅ Index created successfully!");
    return;
  }

  console.log("✅ Index already exists.");
}

async function ingestDocuments() {
  const indexCount = await esClient.count({ index: INDEX_NAME });
  const documentCount = indexCount.count;

  if (documentCount == 0) {
    const datasetPath = "./dataset.json";
    const documents = await loadDataset(datasetPath);

    console.log("Ingesting documents...");

    try {
      const body = documents.flatMap((doc) => [
        { index: { _index: INDEX_NAME } },
        doc,
      ]);

      const response = await esClient.bulk({ body });

      console.log("✅ Documents ingested successfully! ", response);
    } catch (error: any) {
      console.error("❌ Error during ingestion:", error.message);
    }
  }
}

export { createIndex, ingestDocuments, esClient, INDEX_NAME };
