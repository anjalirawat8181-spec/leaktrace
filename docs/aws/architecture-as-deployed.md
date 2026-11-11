# AWS reference deployment: as deployed

Read from the live account on 2026-11-11 with a read-only IAM user (describe, list and get calls only). Account ID redacted as `<ACCOUNT_ID>`. Region `ap-south-1`.

```
Browser --HTTP:80--> EC2 t3.micro "leaktrace-api" (nginx -> Express on 127.0.0.1:3000)
                          |  \--> SQS leaktrace-generation --(alarm)--> Auto Scaling 0..1 --> EC2 t3.micro worker
                          |                                                  |
                          |--> RDS PostgreSQL 16 (private subnets) <---------+
                          |--> S3 leaktrace-data (PDFs, evidence) <----------+
                          |--> SSM Parameter Store /leaktrace/prod (config)
                          |--> EventBridge Scheduler group "leaktrace" --> SQS leaktrace-exam-events --> API consumer
                          \--> SNS leak-alerts / ops-alerts / release-notices (email)
```

## Network

| Item | Value |
|---|---|
| VPC | `leaktrace-vpc`, `10.0.0.0/16` |
| Public subnets | `10.0.1.0/24` (ap-south-1a), `10.0.2.0/24` (ap-south-1b); route `0.0.0.0/0` to the internet gateway |
| Private subnets | `10.0.11.0/24` (1a), `10.0.12.0/24` (1b); no internet route |
| S3 gateway endpoint | attached to both private route tables (no charge) |
| NAT gateways, load balancers, Elastic IPs | none |

## Security groups

| Group | Inbound | Notes |
|---|---|---|
| `leaktrace-api-sg` | TCP 80 from `0.0.0.0/0`, one single-address rule and the CloudFront origin-facing prefix list | the description says "HTTP from CloudFront only", but the rule `0.0.0.0/0` makes it open to the internet; there is no CloudFront distribution in the account |
| `leaktrace-worker-sg` | none | outbound only |
| `leaktrace-db-sg` | TCP 5432 from the API and worker groups only | |

## Compute

| Resource | Setting |
|---|---|
| API server | `t3.micro`, Amazon Linux 2023, public subnet 1a, 16 GB gp3 root volume (unencrypted), IMDSv2 required, no key pair (access through Session Manager), public IPv4 address (not an Elastic IP) |
| Worker launch template `leaktrace-worker-lt` | `t3.micro`, same AMI, `leaktrace-worker-sg`, instance profile `leaktrace-worker-role`, IMDSv2 required, user data = `infra/user-data-worker.sh` |
| Auto Scaling group `leaktrace-workers` | min 0, max 1, desired 0 at rest, both public subnets, EC2 health checks, 300 s grace and cooldown |
| Scaling policies | `scale-out` and `scale-in`, both step scaling with exact capacity: out sets 1, in sets 0 |

## Scaling alarms

| Alarm | Rule | Action |
|---|---|---|
| `leaktrace-queue-has-work` | `leaktrace-generation` visible messages, Maximum over 60 s, at least 1, one period, missing data = not breaching | `scale-out` |
| `leaktrace-queue-empty` | visible + in-flight messages (metric math `m1+m2`), 60 s periods, at most 0 for 5 of 5 periods, missing data = breaching | `scale-in` |
| `leaktrace-dlq-not-empty` | dead-letter queue visible messages at least 1 | SNS `leaktrace-ops-alerts` |

## Database

`leaktrace-db`: RDS PostgreSQL 16.15, `db.t4g.micro`, 20 GB gp2, encrypted, single-AZ (1b), not publicly accessible, 1-day automated backups, **deletion protection on**, in subnet group `leaktrace-db-subnets` (both private subnets).

## Storage

| Bucket | Purpose | Settings |
|---|---|---|
| `leaktrace-data-ccl2026` | generated PDFs under `papers/`, evidence photos under `evidence/` | versioning on, AES-256, all public access blocked, lifecycle: `papers/` expire after 60 days, old versions after 7 days. **No CORS rule**, so a browser cannot upload evidence photos straight to it |
| `leaktrace-deploy-ccl2026` | release tarballs for the API and the worker | AES-256, public access blocked |
| `leaktrace-web-ccl2026` | static web build | AES-256, public access blocked |

## Messaging and scheduling

| Resource | Settings |
|---|---|
| SQS `leaktrace-generation` | visibility 300 s, retention 4 days, long polling 20 s, SSE, redrive to the DLQ after 3 receives |
| SQS `leaktrace-generation-dlq` | retention 14 days, visibility 30 s |
| SQS `leaktrace-exam-events` | visibility 60 s, retention 4 days, long polling 20 s |
| SNS | `leaktrace-leak-alerts`, `leaktrace-ops-alerts`, `leaktrace-release-notices`; two email subscriptions each |
| EventBridge Scheduler | group `leaktrace`; one-time `at(...)` schedules in `Asia/Kolkata`, target `leaktrace-exam-events`, role `leaktrace-scheduler-role`, `ActionAfterCompletion = DELETE`, retry for up to 24 hours |

## Identity

| Role | Trust | What it may do |
|---|---|---|
| `leaktrace-api-role` | EC2 | read `/leaktrace/prod*` parameters; read `papers/*` and the deploy bucket; read and write `evidence/*`; send to the generation queues; read the exam-events queue; publish to `leaktrace-*` topics; create, delete and read schedules in the `leaktrace` group; pass `leaktrace-*` roles to Scheduler; put `LeakTrace` custom metrics; describe Auto Scaling groups; read the web bucket; plus the AWS-managed `CloudWatchAgentServerPolicy` and `AmazonSSMManagedInstanceCore` |
| `leaktrace-worker-role` | EC2 | read `/leaktrace/prod*` parameters; receive from the generation queue; read and write `papers/*`; read the deploy bucket; put `LeakTrace` metrics; plus the same two managed policies |
| `leaktrace-scheduler-role` | EventBridge Scheduler | `sqs:SendMessage` to `leaktrace-exam-events` only |

## Configuration

Sixteen parameters under `/leaktrace/prod/`: twelve plain strings (bucket, database host, name and user, queue URLs and ARNs, topic ARNs, scheduler role ARN, worker group name) and four `SecureString` values (database passwords, JWT secret, fingerprint key).

## Observations

- The worker cold start is dominated by the alarm, not by the instance: see `docs/aws/evidence.md`.
- The API server was set up from an earlier first-boot script; the current `infra/user-data-api.sh` also installs and configures nginx. The Terraform ignores user data changes so it does not replace the running server.
- No CloudWatch log group exists. Application logs live in `journald` on each instance, and the worker's logs disappear with the instance when it scales in.
