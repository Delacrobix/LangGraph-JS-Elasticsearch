📊 Workflow graph saved as: ./workflow_graph.png
============================================================
🚀 VC Startup Search System Ready!


🔍 Query: "Find me Series A or Series B logistics and fintech startups in San Francisco or New York that have raised between $5M to $25M from top tier investors like Sequoia Capital, Kleiner Perkins, or Tiger Global Management, founded in the last 3 years, with monthly revenue above $400K and between 40-120 employees, focusing on B2B or B2B2C business models with AI-powered solutions, supply chain optimization, or financial technology innovations"

🔍 Extracted filters:

```json
{
  "industry": [
    "logistics",
    "fintech"
  ],
  "location": [
    "San Francisco, CA",
    "New York, NY"
  ],
  "funding_stage": [
    "Series A",
    "Series B"
  ],
  "business_model": [
    "B2B",
    "B2B2C"
  ],
  "funding_amount_gte": 5000000,
  "employee_count_gte": 40,
  "founded_year_gte": 2023
}
```

🔍 Semantic query: logistics fintech AI-powered solutions supply chain optimization financial technology innovations startups

🔍 Searching with semantic query: "logistics fintech AI-powered solutions supply chain optimization financial technology innovations startups"

🔍 With Elasticsearch filters: 

```json
{
  "bool": {
    "filter": [
      {
        "terms": {
          "metadata.industry": [
            "logistics",
            "fintech"
          ]
        }
      },
      {
        "terms": {
          "metadata.location": [
            "San Francisco, CA",
            "New York, NY"
          ]
        }
      },
      {
        "terms": {
          "metadata.funding_stage": [
            "Series A",
            "Series B"
          ]
        }
      },
      {
        "terms": {
          "metadata.business_model": [
            "B2B",
            "B2B2C"
          ]
        }
      },
      {
        "range": {
          "metadata.funding_amount": {
            "gte": 5000000
          }
        }
      },
      {
        "range": {
          "metadata.employee_count": {
            "gte": 40
          }
        }
      },
      {
        "range": {
          "metadata.founded_year": {
            "gte": 2023
          }
        }
      }
    ]
  }
}
```

🎯 Found 10 startups matching your criteria:

1. **TechFlow**
   📍 San Francisco, CA | 🏢 logistics | 💼 B2B
   💰 Series A - $8.0M
   👥 45 employees | 📈 $500K MRR
   🏦 Lead: Sequoia Capital
   📝 TechFlow optimizes supply chain operations using AI-powered route optimization and real-time tracking. Founded in 2023, shows remarkable growth with $500K monthly revenue.

2. **LastMile Logistics**
   📍 San Francisco, CA | 🏢 logistics | 💼 B2B2C
   💰 Series A - $14.0M
   👥 67 employees | 📈 $580K MRR
   🏦 Lead: Benchmark Capital
   📝 LastMile Logistics revolutionizes final-mile delivery through micro-fulfillment centers and crowdsourced drivers. Uses predictive analytics for under 30-minute delivery times.

3. **SmartRetail**
   📍 Atlanta, GA | 🏢 retail tech | 💼 B2B
   💰 Series B - $19.0M
   👥 92 employees | 📈 $780K MRR
   🏦 Lead: Norwest Venture Partners
   📝 SmartRetail provides AI-powered inventory management and customer analytics for retail chains. Platform reduces inventory costs by 25% while improving customer satisfaction.

4. **UrbanMobility**
   📍 New York, NY | 🏢 logistics | 💼 B2B2C
   💰 Series B - $15.0M
   👥 78 employees | 📈 $750K MRR
   🏦 Lead: Kleiner Perkins
   📝 UrbanMobility revolutionizes urban transportation through autonomous delivery drones and smart logistics hubs. Partners with major retailers for same-day delivery across Manhattan and Brooklyn.

5. **FinanceAI**
   📍 San Francisco, CA | 🏢 fintech | 💼 B2C
   💰 Series C - $25.0M
   👥 120 employees | 📈 $1200K MRR
   🏦 Lead: Tiger Global Management
   📝 FinanceAI provides AI-powered investment advisory services to retail investors. Uses machine learning to analyze market trends with over 100,000 active users.

6. **PropTech Solutions**
   📍 Phoenix, AZ | 🏢 proptech | 💼 B2B
   💰 Series A - $13.0M
   👥 61 employees | 📈 $540K MRR
   🏦 Lead: Fifth Wall
   📝 PropTech Solutions develops smart building management systems for commercial real estate. IoT sensors and AI optimize energy usage and maintenance schedules.

7. **SmartWarehouse**
   📍 New York, NY | 🏢 logistics | 💼 B2B
   💰 Seed - $5.0M
   👥 32 employees | 📈 $300K MRR
   🏦 Lead: Founders Fund
   📝 SmartWarehouse transforms traditional warehouses into automated facilities using robotics and AI. Robotic systems pick, pack, and sort 5x faster than human workers.

8. **TechMed**
   📍 Los Angeles, CA | 🏢 healthcare | 💼 B2B
   💰 Series A - $9.0M
   👥 54 employees | 📈 $380K MRR
   🏦 Lead: GV (Google Ventures)
   📝 TechMed develops AI-powered diagnostic tools for hospitals and clinics. Platform improves diagnostic accuracy by 45% using computer vision and machine learning.

9. **EcoTransport**
   📍 San Francisco, CA | 🏢 logistics | 💼 B2B
   💰 Series A - $12.0M
   👥 58 employees | 📈 $650K MRR
   🏦 Lead: NEA (New Enterprise Associates)
   📝 EcoTransport provides carbon-neutral delivery services using electric vehicles and optimized routing algorithms. Popular with environmentally conscious brands.

10. **HealthTech Solutions**
   📍 Boston, MA | 🏢 healthcare | 💼 B2B
   💰 Series B - $18.0M
   👥 95 employees | 📈 $900K MRR
   🏦 Lead: General Catalyst
   📝 HealthTech Solutions develops medical devices and software for remote patient monitoring. Comprehensive telehealth platform reducing hospital readmissions by 30%.


✨  Done in 9.91s.