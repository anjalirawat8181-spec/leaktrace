"""Render lab-report screenshots of the AWS deployment changes.

Run with a Python that has Pillow and Pygments, from the repository root:
    /opt/anaconda3/bin/python tools/render_shots.py
"""
import io
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pygments import highlight
from pygments.formatters import ImageFormatter
from pygments.lexers import get_lexer_by_name
from pygments.styles import get_style_by_name

if not hasattr(ImageDraw.ImageDraw, "textsize"):
    def _textsize(self, text, font=None, *args, **kwargs):
        width = self.textlength(text, font=font)
        height = font.getbbox("Mg")[3] if font is not None else 0
        return int(round(width)), height

    ImageDraw.ImageDraw.textsize = _textsize

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "report-shots"
BASE = "a4fb32d"
WIDTH = 1200
MAX_CHARS = 110
MAX_LINES = 40
FONT_SIZE = 16
STYLE = "github-dark"
FONT_PATH = "/System/Library/Fonts/Menlo.ttc"

SHOTS = [
    ("01-config-loader", "added", "packages/adapters/src/aws/config.ts", (1, 31)),
    ("02-s3-adapter", "added", "packages/adapters/src/aws/storage.ts", (1, 34)),
    ("03-sqs-adapter", "added", "packages/adapters/src/aws/queue.ts", (1, 38)),
    ("04-sns-adapter", "added", "packages/adapters/src/aws/notifier.ts", (1, 16)),
    ("05-scheduler-adapter", "added", "packages/adapters/src/aws/scheduler.ts", (8, 47)),
    ("06-db-ssl", "added", "packages/adapters/src/aws/bootstrap.ts", (21, 37)),
    ("07-build-scripts", "modified",
     ["package.json", "apps/api/package.json", "apps/worker/package.json", "apps/api/tsconfig.build.json"], None),
    ("08-package-script", "added", "scripts/package.mjs", (36, 75)),
    ("09-migrate-entry", "added", "apps/api/src/migrate.ts", (177, 201)),
    ("10-seed-entry", "added", "apps/api/src/seed.ts", (1, 40)),
    ("11-health-port80", "modified", ["apps/api/src/app.ts", "apps/api/src/server.ts"], None),
    ("12-user-data-api", "added", "infra/user-data-api.sh", (1, 20)),
    ("13-user-data-worker", "added", "infra/user-data-worker.sh", (1, 20)),
    ("14-systemd-unit", "added", "infra/user-data-api.sh", (21, 47)),
]

CAPTIONS = {
    "01-config-loader": "Loads every parameter under /leaktrace/prod from SSM Parameter Store at startup, decrypting "
    "SecureStrings and keying each value by its last path segment. It replaces the .env file in AWS mode so no "
    "secrets live on the instance or in code.",
    "02-s3-adapter": "Implements the existing Storage interface on Amazon S3: upload, download, existence check and "
    "short-lived presigned download links. Generated papers and evidence photos move from the local disk to a bucket "
    "that both the API and the worker can reach.",
    "03-sqs-adapter": "Implements the Queue interface on Amazon SQS, long-polling up to 20 seconds and reporting how "
    "often a message was received. Failed messages are not deleted, so the queue's redrive policy moves them to the "
    "dead-letter queue.",
    "04-sns-adapter": "Implements the Notifier interface on Amazon SNS, sending leak, ops and release alerts to "
    "their own topics. This replaces the local notifications table so alerts can reach email subscribers.",
    "05-scheduler-adapter": "Implements the Scheduler interface on EventBridge Scheduler, creating one-time "
    "release and close schedules in Asia/Kolkata time that deliver to the exam-events queue. Re-scheduling updates "
    "the existing schedule instead of failing.",
    "06-db-ssl": "Builds the PostgreSQL connection for RDS from the SSM parameters with SSL turned on. RDS is "
    "reached over the network in AWS, so the connection must be encrypted.",
    "07-build-scripts": "Adds build scripts that compile the API and worker with tsc into dist/, a separate tsconfig "
    "for that build, and the root npm run package command. The EC2 instances run plain node on compiled JavaScript "
    "instead of tsx.",
    "08-package-script": "Stages each app with its compiled code and only its production dependencies, then creates "
    "a tarball that unpacks straight into /opt/leaktrace/<app>. It also checks that each archive contains its entry "
    "file.",
    "09-migrate-entry": "A standalone migration entry point that creates the database schema only when it is "
    "missing, inside one transaction. It is safe to run on every service start, which is how the API instance uses "
    "it.",
    "10-seed-entry": "A standalone, idempotent seed entry point for the demo users, centres, rooms and exam. It reads "
    "the database settings from SSM in AWS mode or from DATABASE_URL locally.",
    "11-health-port80": "The health check now answers {\"status\":\"ok\"} for the load balancer or monitoring, and the "
    "API listens on port 80 in AWS mode after loading SSM settings. Local mode keeps its old startup path.",
    "12-user-data-api": "First-boot script for the API instance: installs Node.js 20 and the PostgreSQL client, "
    "creates the leaktrace user, and fetches and unpacks api.tar.gz from the ccl2026 deploy bucket.",
    "13-user-data-worker": "The same first-boot steps for the worker instances in the Auto Scaling group, using "
    "worker.tar.gz and /opt/leaktrace/worker.",
    "14-systemd-unit": "The systemd unit that runs the API as the unprivileged leaktrace user, migrates before each "
    "start, binds port 80 through CAP_NET_BIND_SERVICE and restarts until the database is ready. The worker unit is "
    "the same without the port capability.",
}


def secret_values():
    values = {"ChangeMe123!"}
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            key, _, value = line.partition("=")
            if re.search(r"PASSWORD|SECRET|TOKEN|KEY", key) and len(value) >= 6:
                values.add(value)
    return values


SECRETS = secret_values()
SECRET_PATTERNS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"(?<![\w.])\d{12}(?![\w.])"),
    re.compile(r"(aws_secret_access_key\s*[=:]\s*)\S+", re.I),
]


def redact(text):
    for value in SECRETS:
        text = text.replace(value, "********")
    for pattern in SECRET_PATTERNS:
        text = pattern.sub(lambda m: (m.group(1) if m.groups() else "") + "********", text)
    return text


def trim(line):
    return line if len(line) <= MAX_CHARS else line[: MAX_CHARS - 1] + "…"


def file_excerpt(path, span):
    lines = (ROOT / path).read_text().splitlines()
    start, end = span
    chosen = lines[start - 1:end]
    assert len(chosen) <= MAX_LINES, (path, len(chosen))
    return "\n".join(trim(redact(l)) for l in chosen), start


def git_diff(paths):
    raw = subprocess.run(
        ["git", "diff", "-U1", f"{BASE}..HEAD", "--", *paths], cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    lines = [l for l in raw.splitlines() if not l.startswith(("index ", "new file mode", "--- ", "diff --git"))]
    return [f"diff {l[6:]}" if l.startswith("+++ b/") else l for l in lines]


def diff_excerpt(name, paths):
    lines = git_diff(paths)
    if name == "11-health-port80":
        server_start = next(i for i, l in enumerate(lines) if l == "diff apps/api/src/server.ts")
        head = lines[:server_start + 1]
        body = lines[server_start + 1:]
        a = next(i for i, l in enumerate(body) if l.startswith("+const AWS_PORT"))
        b = next(i for i, l in enumerate(body) if "LeakTrace API listening" in l and l.startswith("+"))
        lines = head + ["@@ server.ts: AWS startup and port 80 @@"] + body[a:b + 2]
    assert len(lines) <= MAX_LINES, (name, len(lines))
    return "\n".join(trim(redact(l)) for l in lines), 1


def lexer_for(path, is_diff):
    if is_diff:
        return get_lexer_by_name("diff")
    suffix = Path(path).suffix
    return get_lexer_by_name({".ts": "typescript", ".mjs": "javascript", ".sh": "bash", ".json": "json"}[suffix])


def render(name, status, paths, span):
    is_diff = span is None
    label_path = ", ".join(paths) if isinstance(paths, list) else paths
    code, first_line = diff_excerpt(name, paths) if is_diff else file_excerpt(paths, span)
    style = get_style_by_name(STYLE)
    formatter = ImageFormatter(
        style=STYLE, font_name="Menlo", font_size=FONT_SIZE, line_numbers=True, line_number_start=first_line,
        line_number_bg=style.background_color, line_number_fg="#6e7681", line_number_separator=True,
        line_pad=4, image_pad=14, image_format="png",
    )
    code_img = Image.open(io.BytesIO(highlight(code, lexer_for(label_path, is_diff), formatter))).convert("RGB")
    assert code_img.width <= WIDTH, (name, code_img.width)

    header_h = 46
    canvas = Image.new("RGB", (WIDTH, header_h + code_img.height), style.background_color)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, 0, WIDTH, header_h], fill="#161b22")
    draw.line([0, header_h - 1, WIDTH, header_h - 1], fill="#30363d", width=1)
    font = ImageFont.truetype(FONT_PATH, 15)
    shown_path = label_path if len(label_path) <= 100 else label_path[:99] + "…"
    draw.text((16, 14), shown_path, font=font, fill="#e6edf3")
    badge_color = "#3fb950" if status == "added" else "#d29922"
    text_w = draw.textlength(status, font=font)
    bx1 = WIDTH - 16
    bx0 = bx1 - text_w - 24
    draw.rounded_rectangle([bx0, 10, bx1, header_h - 10], radius=12, outline=badge_color, width=2)
    draw.text((bx0 + 12, 14), status, font=font, fill=badge_color)
    canvas.paste(code_img, (0, header_h))
    canvas.save(OUT / f"{name}.png")


def main():
    OUT.mkdir(exist_ok=True)
    for name, status, paths, span in SHOTS:
        render(name, status, paths, span)
    with open(OUT / "captions.md", "w") as f:
        for name, *_ in SHOTS:
            f.write(f"{name}.png: {CAPTIONS[name]}\n")
    print(f"Rendered {len(SHOTS)} images to {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
