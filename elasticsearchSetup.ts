import fs from "node:fs/promises";
import { Client } from "@elastic/elasticsearch";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const INDEX_NAME: string = "startups-index";
const STRICT_SEARCH_TEMPLATE_ID = "startup-strict-search-template";
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
  semantic_field: z.string(),
  company_name: z.string(),
  industry: z.string(),
  location: z.string(),
  funding_stage: z.string(),
  funding_amount: z.number(),
  lead_investor: z.string(),
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
          description: {
            type: "text",
            copy_to: "semantic_field",
          },
          company_name: {
            type: "keyword",
            copy_to: "semantic_field",
          },
          industry: {
            type: "keyword",
            copy_to: "semantic_field",
          },
          location: {
            type: "keyword",
            copy_to: "semantic_field",
          },
          funding_stage: {
            type: "keyword",
            copy_to: "semantic_field",
          },
          funding_amount: { type: "long" },
          lead_investor: {
            type: "keyword",
            copy_to: "semantic_field",
          },
          monthly_revenue: { type: "long" },
          employee_count: { type: "integer" },
          business_model: {
            type: "keyword",
            copy_to: "semantic_field",
          },
          semantic_field: { type: "semantic_text" },
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

      console.log("✅ Documents ingested successfully!");
    } catch (error: any) {
      console.error("❌ Error during ingestion:", error.message);
    }
  }
}

// Register hybrid search templates in Elasticsearch
async function createSearchTemplates() {
  try {
    console.log("🔧 Creating strict search template...");

    await esClient.putScript({
      id: STRICT_SEARCH_TEMPLATE_ID,
      script: {
        lang: "mustache",
        source: `{
          "size": 5,
          "retriever": {
            "rrf": {
              "retrievers": [
                {
                  "standard": {
                    "query": {
                      "semantic": {
                        "field": "semantic_field",
                        "query": "{{query_text}}"
                      }
                    }
                  }
                },
                {
                  "standard": {
                    "query": {
                      "bool": {
                        "filter": [
                          {{#industry}}
                          {
                            "terms": {
                              "industry": {{#toJson}}industry{{/toJson}}
                            }
                          },
                          {{/industry}}
                          {{#location}}
                          {
                            "terms": {
                              "location": {{#toJson}}location{{/toJson}}
                            }
                          },
                          {{/location}}
                          {{#funding_stage}}
                          {
                            "terms": {
                              "funding_stage": {{#toJson}}funding_stage{{/toJson}}
                            }
                          },
                          {{/funding_stage}}
                          {{#funding_amount_gte}}
                          {
                            "range": {
                              "funding_amount": {
                                "gte": {{funding_amount_gte}}
                                {{#funding_amount_lte}},"lte": {{funding_amount_lte}}{{/funding_amount_lte}}
                              }
                            }
                          },
                          {{/funding_amount_gte}}
                          {{#lead_investor}}
                          {
                            "terms": {
                              "lead_investor": {{#toJson}}lead_investor{{/toJson}}
                            }
                          }
                          {{/lead_investor}}
                        ]
                      }
                    }
                  }
                }
              ],
              "rank_window_size": 100,
              "rank_constant": 20
            }
          }
        }`,
      },
    });

    console.log("✅ Strict search template created successfully!");
  } catch (error) {
    console.error("❌ Error creating search templates:", error);
  }
}

export {
  createIndex,
  ingestDocuments,
  createSearchTemplates,
  esClient,
  INDEX_NAME,
  STRICT_SEARCH_TEMPLATE_ID,
};
