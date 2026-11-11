# AWS inventory: LeakTrace reference deployment

Read-only snapshot taken on 2026-11-11 with the `anjali-readonly` IAM user (describe/list/get and Cost Explorer calls only).
Account ID redacted as `<ACCOUNT_ID>`. Public IPs and DNS names of resources that will be deleted are not recorded.
Primary region: `ap-south-1` (Mumbai).

## Cost

| Item | Value |
|---|---|
| Running cost of LeakTrace right now (estimate) | **about $0.75 per day, about ₹66 per day** (₹88/USD assumed) |
| Per month at that rate | about $22.5, about ₹1,980 |
| Worker ASG | desired 0, so workers add cost only while a generation job runs |

How the daily figure was derived: Cost Explorer, `RECORD_TYPE=Usage` (before credits), `ap-south-1`, averaged over 2026-11-08 to 2026-11-10, by usage type.
Everything in `ap-south-1` corresponds to a LeakTrace resource listed below, so the region total is attributed to LeakTrace.
The resources carry no cost-allocation tag, so Cost Explorer cannot filter by project. This is why the figure is an estimate.

| Usage type | USD/day |
|---|---|
| EC2 `t3.micro` (API server) | 0.192 |
| RDS `db.t4g.micro` instance hours | 0.371 |
| RDS gp2 storage (20 GB) | 0.064 |
| Public IPv4 address (API server) | 0.088 |
| EBS gp3 (16 GB root volume) | 0.034 |
| **Total** | **0.750** |

S3, SQS, SNS, SSM standard parameters and the S3 gateway endpoint are free or under $0.01/day at this volume.

Month-to-date for the whole account (2026-11-01 to 2026-11-11), gross usage before credits: **$14.83**, of which **$9.45** is `ap-south-1` and **$5.38** is `eu-north-1` (not LeakTrace).
AWS credits of -$14.83 were applied, so the net bill so far is $0.00. The credits are finite, so the resources are still consuming them.

## LeakTrace resources (ours)

### Compute and storage (ap-south-1)

| Resource | Details |
|---|---|
| EC2 instance `leaktrace-api` | `i-090080767784a1d40`, `t3.micro`, running, launched 2026-10-20, one public IPv4 (not an Elastic IP) |
| EBS volume | `vol-021a241f6e4bcf37a`, 16 GB gp3, root volume of the API instance |
| Launch template | `leaktrace-worker-lt` (`t3.micro`) |
| Auto Scaling group | `leaktrace-workers`: min 0, max 1, desired 0, 0 in service |
| RDS PostgreSQL | `leaktrace-db`, `db.t4g.micro`, 20 GB gp2, single-AZ, not public, backup retention 1 day |
| RDS snapshots | 3 automated snapshots (2026-11-08, 11-09, 11-10), deleted automatically with the instance unless a final snapshot is kept |
| Load balancers, NAT gateways, Elastic IPs, AMIs, EBS snapshots | none |
| VPC | `vpc-034cf1a66b4711c37` (`leaktrace-vpc`) with one S3 gateway endpoint (free) |
| Security groups | `leaktrace-api-sg`, `leaktrace-worker-sg`, `leaktrace-db-sg` (the VPC's own `default` group is not separate) |

### S3

| Bucket | Objects | Size | Notes |
|---|---|---|---|
| `leaktrace-data-ccl2026` | 28 | 5.2 MB | generated PDFs, **versioning enabled** (empty versions and delete markers too when tearing down) |
| `leaktrace-deploy-ccl2026` | 3 | 25.9 MB | release tarballs |
| `leaktrace-web-ccl2026` | 17 | 0.9 MB | static web build |

### Messaging and scheduling

| Resource | Details |
|---|---|
| SQS | `leaktrace-generation`, `leaktrace-generation-dlq`, `leaktrace-exam-events`; all currently 0 messages |
| SNS | `leaktrace-leak-alerts`, `leaktrace-ops-alerts`, `leaktrace-release-notices`; 6 email subscriptions in total |
| EventBridge Scheduler | group `leaktrace`, 0 schedules at snapshot time (schedules are created per exam and removed after firing) |
| CloudWatch alarms | `leaktrace-dlq-not-empty`, `leaktrace-queue-empty` (currently ALARM, expected with an empty queue), `leaktrace-queue-has-work` |
| CloudWatch log groups | none |

### Configuration and identity

| Resource | Details |
|---|---|
| SSM parameters (16, names only) | under `/leaktrace/prod/`: `DATA_BUCKET`, `DB_ADMIN_PASSWORD`*, `DB_NAME`, `DB_PASSWORD`*, `DB_HOST`, `DB_USER`, `EXAM_EVENTS_QUEUE_ARN`, `EXAM_EVENTS_QUEUE_URL`, `GENERATION_QUEUE_URL`, `OPS_ALERTS_TOPIC_ARN`, `RELEASE_NOTICES_TOPIC_ARN`, `LEAK_ALERTS_TOPIC_ARN`, `SCHEDULER_ROLE_ARN`, `WORKER_ASG_NAME`, `FINGERPRINT_KEY`*, `JWT_SECRET`* (*SecureString) |
| IAM roles | `leaktrace-api-role`, `leaktrace-worker-role`, `leaktrace-scheduler-role` |
| Instance profiles | `leaktrace-api-role`, `leaktrace-worker-role` |
| IAM user | `anjali-readonly` (used for this inventory; delete last) |
| Route 53, ACM, NAT gateways, load balancers | none |

## Not ours, do not touch

These exist in the same account and belong to other projects. They are not part of LeakTrace and must stay.

| Resource | Where |
|---|---|
| RDS `ccl-lab-5` (`db.t4g.micro`) and an associated Elastic IP | `eu-north-1` (accounts for the $5.38 above) |
| S3 buckets `10610-pranavkoradiya`, `ccl-test-bucket-<ACCOUNT_ID>-eu-north-1-an`, `crce-tag-ingestion-pranav`, `pranavkoradiya-resume` | global |
| IAM roles `CampusLostFoundEC2Role`, `PL12-FlowLogs-Role`, `rds-monitoring-role`, `ReservationConfirmationRole`, `ReservationProcessorRole`; policy `CampusLostFoundDynamoDBPolicy` | IAM |
| The two `default` security groups, the default VPC `vpc-0e6f652568fe4cbbb`, the `default` Scheduler group | `ap-south-1` |
| Budget `My Zero-Spend Budget` ($1 limit) | Budgets |
| October usage of Lambda, DynamoDB and Secrets Manager | earlier projects |

## What was checked

EC2 instances, volumes, snapshots, Elastic IPs, AMIs, launch templates, security groups, NAT gateways, VPC endpoints, Auto Scaling, load balancers, RDS instances and snapshots, S3, SQS, SNS, Scheduler groups and schedules, SSM, IAM, CloudWatch logs and alarms, Budgets, Route 53 and ACM in `ap-south-1`; EC2, EBS, Elastic IPs and RDS in every enabled region; Cost Explorer by service, region and usage type.
