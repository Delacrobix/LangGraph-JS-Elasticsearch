import { writeFileSync } from "node:fs";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import {
  esClient,
  ingestDocuments,
  createIndex,
  createSearchTemplates,
  INDEX_NAME,
  STRICT_SEARCH_TEMPLATE_ID,
} from "./elasticsearchSetup.js";

const llm = new ChatOpenAI({ model: "gpt-4o-mini" });

// Define state for workflow
const VCState = Annotation.Root({
  input: Annotation<string>(), // User's natural language query
  searchStrategy: Annotation<string>(), // Search strategy decision: "strict" or "flexible"
  searchParams: Annotation<any>(), // Prepared search parameters with template_id
  results: Annotation<any[]>(), // Search results
  final: Annotation<string>(), // Final formatted response
});

// Extract available filter values from Elasticsearch using aggregations
async function getAvailableFilters() {
  try {
    const response = await esClient.search({
      index: INDEX_NAME,
      size: 0,
      aggs: {
        industries: {
          terms: { field: "industry", size: 100 },
        },
        locations: {
          terms: { field: "location", size: 100 },
        },
        funding_stages: {
          terms: { field: "funding_stage", size: 20 },
        },
        business_models: {
          terms: { field: "business_model", size: 10 },
        },
        lead_investors: {
          terms: { field: "lead_investor", size: 100 },
        },
        funding_amount_stats: {
          stats: { field: "funding_amount" },
        },
        monthly_revenue_stats: {
          stats: { field: "monthly_revenue" },
        },
        employee_count_stats: {
          stats: { field: "employee_count" },
        },
      },
    });

    return response.aggregations;
  } catch (error) {
    console.error("❌ Error getting available filters:", error);

    return {};
  }
}

// Node 1: Decide search strategy using LLM
async function decideSearchStrategy(state: typeof VCState.State) {
  // Zod schema for hybrid search template decision
  const SearchDecisionSchema = z.object({
    search_type: z
      .enum(["strict", "flexible"])
      .describe("Type of hybrid search template to use"),
    reasoning: z
      .string()
      .describe("Brief explanation of why this search template was chosen"),
  });

  const decisionLLM = llm.withStructuredOutput(SearchDecisionSchema);

  // Get dynamic filters from Elasticsearch
  const availableFilters = await getAvailableFilters();

  const prompt = `Query: "${state.input}"
    Available filters: ${JSON.stringify(availableFilters, null, 2)}

    Choose between two hybrid search templates:
    - "strict" for precise searches with exact criteria (filters are required, semantic similarity secondary)
    - "flexible" for exploratory searches and discovery (semantic similarity primary, filters relevance)
  `;

  try {
    const result = await decisionLLM.invoke(prompt);
    console.log(
      `🤔 Search strategy: ${result.search_type} - ${result.reasoning}`
    );

    return {
      searchStrategy: result.search_type,
    };
  } catch (error: any) {
    console.error("❌ Error in decideSearchStrategy:", error.message);
    // Default to structured search on error
    return {
      searchStrategy: "structured",
    };
  }
}

// Helper function to extract filter values
async function extractFilterValues(input: string) {
  const FilterValuesSchema = z.object({
    industry: z
      .array(z.string())
      .default([])
      .describe("Industry values mentioned in query"),
    location: z
      .array(z.string())
      .default([])
      .describe("Location values mentioned in query"),
    funding_stage: z
      .array(z.string())
      .default([])
      .describe("Funding stage values mentioned in query"),
    funding_amount_gte: z
      .number()
      .default(0)
      .describe("Minimum funding amount in USD"),
    funding_amount_lte: z
      .number()
      .default(100000000)
      .describe("Maximum funding amount in USD"),
    lead_investor: z
      .array(z.string())
      .default([])
      .describe("Lead investor values mentioned in query"),
  });

  const extractorLLM = llm.withStructuredOutput(FilterValuesSchema);
  const availableFilters = await getAvailableFilters();

  const extractPrompt = `Extract filter values from: "${input}"
    Available options: ${JSON.stringify(availableFilters, null, 2)}
    Extract only values mentioned in the query. Leave fields empty if not mentioned.`;

  return await extractorLLM.invoke(extractPrompt);
}

// Node 2A: Prepare Strict Search Parameters (predefined template with filters + semantic + RRF retrievers)
async function prepareStrictParams(state: typeof VCState.State) {
  console.log(
    "🎯 Preparing STRICT search parameters with predefined RRF template..."
  );

  try {
    // Extract filters for the predefined template
    const values = await extractFilterValues(state.input);

    const searchParams = {
      query_text: state.input,
      industry: values.industry || [],
      location: values.location || [],
      funding_stage: values.funding_stage || [],
      funding_amount_gte: values.funding_amount_gte || 0,
      funding_amount_lte: values.funding_amount_lte || 100000000,
      lead_investor: values.lead_investor || [],
      template_id: STRICT_SEARCH_TEMPLATE_ID,
      search_type: "strict_template_rrf",
    };

    console.log(
      "🎯 STRICT template params (predefined RRF):",
      JSON.stringify(searchParams, null, 2)
    );

    return { searchParams };
  } catch (error) {
    console.error("❌ Error preparing strict params:", error);
    return {
      searchParams: {},
    };
  }
}

// Node 2B: Prepare Flexible Search Parameters (dynamic query built from LLM-extracted filters)
async function prepareFlexibleParams(state: typeof VCState.State) {
  console.log(
    "� Preparing FLEXIBLE search parameters with LLM-driven dynamic query..."
  );

  try {
    // Extract filters using LLM and build dynamic query
    const values = await extractFilterValues(state.input);

    // Build dynamic query based on extracted filters
    const mustClauses = [
      {
        semantic: {
          field: "semantic_field",
          query: state.input,
        },
      },
    ];

    const shouldClauses = [];

    if (values.industry && values.industry.length > 0) {
      shouldClauses.push({
        terms: {
          industry: values.industry,
        },
      });
    }

    if (values.funding_stage && values.funding_stage.length > 0) {
      shouldClauses.push({
        terms: {
          funding_stage: values.funding_stage,
        },
      });
    }

    if (values.location && values.location.length > 0) {
      shouldClauses.push({
        terms: {
          location: values.location,
        },
      });
    }

    if (values.lead_investor && values.lead_investor.length > 0) {
      shouldClauses.push({
        terms: {
          lead_investor: values.lead_investor,
        },
      });
    }

    if (
      (values.funding_amount_gte && values.funding_amount_gte > 0) ||
      (values.funding_amount_lte && values.funding_amount_lte < 100000000)
    ) {
      shouldClauses.push({
        range: {
          funding_amount: {
            ...(values.funding_amount_gte &&
              values.funding_amount_gte > 0 && {
                gte: values.funding_amount_gte,
              }),
            ...(values.funding_amount_lte &&
              values.funding_amount_lte < 100000000 && {
                lte: values.funding_amount_lte,
              }),
          },
        },
      });
    }

    const dynamicQuery = {
      size: 5,
      query: {
        bool: {
          must: mustClauses,
          should: shouldClauses,
          minimum_should_match: 2,
        },
      },
    };

    const searchParams = {
      query_text: state.input,
      dynamic_query: dynamicQuery,
      extracted_filters: values,
      search_type: "flexible_dynamic_llm",
    };

    console.log(
      "🌟 FLEXIBLE dynamic query built from LLM:",
      JSON.stringify(searchParams.dynamic_query, null, 2)
    );

    return { searchParams };
  } catch (error) {
    console.error("❌ Error preparing flexible params:", error);
    return {};
  }
}

// Node 3: Execute Search
async function executeSearch(state: typeof VCState.State) {
  console.log(`🔍 Executing ${state.searchParams.search_type} search...`);

  try {
    const { searchParams } = state;

    let results;

    if (searchParams.dynamic_query) {
      // Strict: Execute dynamic query built in code
      console.log(
        `📋 ${searchParams.search_type.toUpperCase()} DYNAMIC QUERY:`,
        JSON.stringify(searchParams.dynamic_query, null, 2)
      );

      results = await esClient.search({
        index: INDEX_NAME,
        ...searchParams.dynamic_query,
      });
    } else {
      // Flexible: Execute template-based query
      const renderedTemplate = await esClient.renderSearchTemplate({
        id: searchParams.template_id,
        params: searchParams,
      });

      console.log(
        `📋 ${searchParams.search_type.toUpperCase()} TEMPLATE QUERY:`,
        JSON.stringify(renderedTemplate.template_output, null, 2)
      );

      results = await esClient.searchTemplate({
        index: INDEX_NAME,
        id: searchParams.template_id,
        params: searchParams,
      });
    }

    return {
      results: results.hits.hits.map((hit: any) => hit._source),
    };
  } catch (error) {
    console.error(`❌ ${state.searchParams.search_type} search error:`, error);
    return { results: [] };
  }
}

// Node 4: Visualize results
async function visualizeResults(state: typeof VCState.State) {
  const results = state.results || [];

  let formattedResults = `🎯 Found ${results.length} startup${
    results.length > 1 ? "s" : ""
  } matching your criteria:\n\n`;

  results.forEach((startup: any, index: number) => {
    formattedResults += `${index + 1}. **${startup.company_name}**\n`;
    formattedResults += `   📍 ${startup.location} | 🏢 ${startup.industry} | 💼 ${startup.business_model}\n`;
    formattedResults += `   💰 ${startup.funding_stage} - $${(
      startup.funding_amount / 1000000
    ).toFixed(1)}M\n`;
    formattedResults += `   👥 ${startup.employee_count} employees | 📈 $${(
      startup.monthly_revenue / 1000
    ).toFixed(0)}K MRR\n`;
    formattedResults += `   🏦 Lead: ${startup.lead_investor}\n`;
    formattedResults += `   📝 ${startup.description}\n\n`;
  });

  return {
    final: formattedResults,
  };
}

async function saveGraphImage(app: any): Promise<void> {
  try {
    const drawableGraph = app.getGraph();
    const image = await drawableGraph.drawMermaidPng();
    const arrayBuffer = await image.arrayBuffer();

    const filePath = "./workflow_graph.png";
    writeFileSync(filePath, new Uint8Array(arrayBuffer));
    console.log(`📊 Workflow graph saved as: ${filePath}`);
  } catch (error: any) {
    console.log("⚠️  Could not save graph image:", error.message);
  }
}

async function main() {
  await createIndex();
  await ingestDocuments();
  await createSearchTemplates();

  // Create the workflow graph with shared state
  const workflow = new StateGraph(VCState)
    // Register nodes - these are the processing functions
    .addNode("decideStrategy", decideSearchStrategy)
    .addNode("prepareStrictParams", prepareStrictParams)
    .addNode("prepareFlexibleParams", prepareFlexibleParams)
    .addNode("executeSearch", executeSearch)
    .addNode("visualizeResults", visualizeResults)
    // Define execution flow with conditional branching
    .addEdge("__start__", "decideStrategy") // Start with strategy decision
    .addConditionalEdges(
      "decideStrategy",
      (state: typeof VCState.State) => state.searchStrategy, // Conditional function
      {
        strict: "prepareStrictParams", // If strict -> dynamic query preparation
        flexible: "prepareFlexibleParams", // If flexible -> template preparation
      }
    )
    .addEdge("prepareStrictParams", "executeSearch") // Strict prep -> execute
    .addEdge("prepareFlexibleParams", "executeSearch") // Flexible prep -> execute
    .addEdge("executeSearch", "visualizeResults") // Execute -> visualize
    .addEdge("visualizeResults", "__end__"); // End workflow

  const app = workflow.compile();

  await saveGraphImage(app);

  const strictQuery =
    "Find exactly Series A fintech startups in San Francisco with funding between $10M-$15M from Andreessen Horowitz";

  const flexibleQuery =
    "Find promising early-stage startups in tech hubs that are similar to successful fintech companies";

  console.log("🔍 Testing strict hybrid search...");
  const strictResult = await app.invoke({ input: strictQuery });
  console.log(strictResult.final);
}

main().catch(console.error);
