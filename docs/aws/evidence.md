# AWS evidence pack: the demo run

Taken with a read-only IAM user (describe, list, get, CloudWatch and Cost Explorer calls) on 2026-11-11, after recording the demo twice on the live site. Account ID redacted as `<ACCOUNT_ID>`. Times are UTC; India time is UTC+5:30.

## Worker auto scaling: 0 to 1 and back

Source: `aws autoscaling describe-scaling-activities --auto-scaling-group-name leaktrace-workers`.

| Run | Alarm fired (UTC) | Launch started | Marked in service | Scale-in alarm | Instance terminated |
|---|---|---|---|---|---|
| 1 | 09:31:17 `leaktrace-queue-has-work` | 09:31:26 | 09:36:31 | 09:40:44 `leaktrace-queue-empty` | 09:41:38 |
| 2 | 09:45:17 `leaktrace-queue-has-work` | 09:45:34 | 09:50:38 | 09:53:44 `leaktrace-queue-empty` | 09:54:40 |

Before each run the group had desired 0 and 0 instances in service; after each run it was back to desired 0 with no instances (checked at 09:57 UTC: min 0, max 1, desired 0, in service 0). The group publishes no group metrics (no enabled metrics), so the 0 to 1 to 0 values come from the scaling activity log above rather than from a CloudWatch graph.

## Where the time goes (run 2)

| Interval | Duration |
|---|---|
| Alarm `queue-has-work` fires to the last PDF written to S3 (09:45:17 to 09:46:32) | about 75 s |
| Launch started to the first PDF (09:45:34 to 09:46:27) | about 53 s |
| Click on Generate to the worker coming online, as measured in the recording | about 245 s |
| Worker alive (launch to termination, 09:45:34 to 09:54:40) | about 9 min |

The Auto Scaling activity says the launch finished at 09:50:38, but the PDFs were already in S3 at 09:46:27. So the worker was working about a minute after launch; the five minutes is the group's own bookkeeping. Most of the wait a user sees comes before the instance exists: the queue metric reaches CloudWatch, the one-minute alarm evaluates, and only then the group launches an instance. That is why the free-stack version, with a worker in the API process, finishes the same job in about 28 seconds from the click.

A worker that ran for about 9 minutes on a `t3.micro` costs well under one US cent (derived from the day rate in `docs/aws/inventory.md`).

## SQS, 09:00 to 10:00 UTC (both runs)

Source: CloudWatch `AWS/SQS`, statistic Sum, one-hour period.

| Queue | Messages sent | Received | Deleted |
|---|---|---|---|
| `leaktrace-generation` | 8 | 8 | 8 |
| `leaktrace-exam-events` | 2 | 2 | 2 |
| `leaktrace-generation-dlq` | 0 | 0 | 0 |

Eight generation messages are two exams times four rooms. The two exam-events messages are the two scheduled releases. Nothing reached the dead-letter queue.

## EventBridge Scheduler

Group `leaktrace`. A scheduled release is a one-time schedule, for example `at(2026-11-11T15:56:00)` in `Asia/Kolkata`, targeting `leaktrace-exam-events` with `ActionAfterCompletion = DELETE`.

| When checked | Schedules in the group |
|---|---|
| Before the recordings | 0 |
| After both recordings | 2, the pending `leaktrace-close-<exam id>` schedules (both `ENABLED`); the two release schedules had already fired and deleted themselves |

## Generated PDFs in S3

`aws s3api list-objects-v2 --bucket leaktrace-data-ccl2026 --prefix papers/`, objects modified on 2026-11-11:

| Exam | Object | Size (bytes) | Written (UTC) |
|---|---|---|---|
| run 1 | `C1/C1-Room 1.pdf` | 89,598 | 09:32:17 |
| run 1 | `C1/C1-Room 2.pdf` | 90,422 | 09:32:22 |
| run 1 | `C2/C2-Room 1.pdf` | 90,295 | 09:32:21 |
| run 1 | `C2/C2-Room 2.pdf` | 90,083 | 09:32:19 |
| run 2 | `C1/C1-Room 1.pdf` | 89,699 | 09:46:27 |
| run 2 | `C1/C1-Room 2.pdf` | 90,172 | 09:46:28 |
| run 2 | `C2/C2-Room 1.pdf` | 89,742 | 09:46:30 |
| run 2 | `C2/C2-Room 2.pdf` | 89,613 | 09:46:32 |

Each file is one room's bundle (five seat copies). The whole bucket holds 36 objects, 6.2 MB.

## Worker log lines

Not captured. The worker writes `MESSAGE_RECEIVED`, `ROOM_RENDERED`, `S3_UPLOAD_DONE` and `ROOM_SAVED` to `journald` on the instance. There is no CloudWatch log group, the instances were already terminated when the read-only access ran, and reading `journald` needs a Session Manager session, which is not a read-only call. The S3 timestamps above and the queue counts are the evidence that those four steps happened for all eight room messages. The same four events appear in the free-stack worker logs on Render.

## Project cost

| Measure | Value |
|---|---|
| Gross usage in `ap-south-1`, 2026-10-20 to 2026-11-11 (Cost Explorer, usage before credits) | $21.80 ($11.69 in October from the 20th, $10.11 in November) |
| Credits applied to the account | the whole usage; the net bill is $0.00 |
| Steady-state cost of what is running now | about $0.75 per day (about ₹66), see `docs/aws/inventory.md` |

The $21.80 is an upper bound for LeakTrace: Cost Explorer cannot filter by project because the resources carry no cost-allocation tag, so it includes anything else that ran in that region over the same days. Cost Explorer also lags by about a day, so the two demo recordings are not in it yet.
