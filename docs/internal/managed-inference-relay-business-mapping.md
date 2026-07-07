# Managed Inference Relay — Business Mapping

Status: Internal note  
Audience: NueOS product, platform, operations, and business planning

This note maps the public developer-facing terminology for the managed inference relay to the business and operating concepts it supports. Public architecture docs should use the developer-facing terms. Business planning, pricing, and operating reviews may use the business-side terms here.

## Terminology Map

| Developer-facing term | Business / operating meaning | Notes |
|---|---|---|
| Nue-managed inference | NueOS Cloud inference product surface | Tenant calls Nue rather than configuring each backend provider directly. |
| Tenant auth | Customer/org entitlement boundary | Identifies account, workspace, plan, permissions, and policy. |
| Tenant policy | Plan, contract, quota, and data-policy constraints | Keep public docs focused on policy and entitlement rather than sales packaging. |
| Usage metering | Billable and operational usage capture | Public docs can say usage metering; invoices and plan logic live elsewhere. |
| Usage ledger | Billing ledger plus operational audit trail | Use usage ledger in public docs; map to billing/reconciliation internally. |
| Quota enforcement | Plan limit and abuse-control enforcement | Includes subscription limits, spend controls, and operational protection. |
| Provider selection | Cost, quality, latency, availability, and policy route choice | Public docs should avoid implying user requests are routed only for Nue margin. |
| Capability and routing catalog | Pricing, capability, quota, health, and policy catalog | Public docs should emphasize capability/routing; internal systems may include provider pricing and cost metadata. |
| Cost efficiency | COGS-aware model routing | Acceptable in public docs when paired with quality, latency, health, and policy. |
| Cost controls | Spend guardrails and predictable operating cost | Avoid exposing provider cost versus customer charge in public examples. |
| Server-side managed connector | Backend cloud/provider supply integration | Covers Vertex, Bedrock, Azure, direct frontier APIs, and internal open-weight pools. |
| Regional relay | Low-overhead data-plane pass-through service | Supports latency control, provider credential secrecy, metering, and policy enforcement. |
| Relay token | Short-lived authorization for one routed inference session | Business value: scoped access, replay control, quota enforcement, and traceability. |
| Route health and policy evaluation | Operational and economic route evaluation | Internal dashboards may include cost and margin views; public docs should focus on health, usage, policy, and reliability. |

## Public Docs Tone Rule

Public developer docs may acknowledge that NueOS Cloud is a managed business/platform surface. They should avoid phrasing that suggests OSS contributions or tenant requests are primarily a margin-extraction mechanism.

Prefer:

- usage metering
- quota enforcement
- provider selection
- cost efficiency
- capability and routing catalog
- usage and operations dashboards
- server-side managed connector

Avoid in public docs unless specifically needed:

- unit economics
- margin
- profit
- cost arbitrage
- billable amount next to provider cost
- business-sensitive routing
- supply optimization
- cheap / premium aliases as canonical public names

## Public-to-Business Crosswalk

| Public docs phrase | Internal business phrase |
|---|---|
| usage metering | billing meter |
| usage ledger | billing and reconciliation ledger |
| quota enforcement | plan limit / spend control |
| cost efficiency | gross-margin-aware COGS management |
| provider selection | provider procurement and route optimization |
| capability and routing catalog | pricing, capability, and capacity catalog |
| usage and operations dashboards | unit economics and operating dashboards |
| tenant policy | contract, plan, and data-policy terms |
| server-side managed connector | managed reseller/provider backend integration |

## Open Business Questions

- Which public model aliases should map to paid plan capabilities?
- Which provider routes are allowed by default for each tenant policy?
- Which usage events become billable events versus operations-only events?
- Which cost and margin fields remain internal-only?
- Which BYOC/BYOK routes are productized separately from Nue-managed inference?