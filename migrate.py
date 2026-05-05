#!/usr/bin/env python3
"""Migrate Grav CMS blog posts to Jekyll _posts/ format."""

import os
import re
import sys
from datetime import datetime
from pathlib import Path

GRAV_BLOG = Path('/Users/arsabolsky/Documents/Work/EYARC/BLOG/BlueHost/user/pages/01.blog')
JEKYLL_POSTS = Path('/Users/arsabolsky/Documents/Work/EYARC/BLOG/eyarc-blog/_posts')

JEKYLL_POSTS.mkdir(parents=True, exist_ok=True)

def parse_date(raw):
    """Parse Grav date string (MM-DD-YYYY HH:mm or similar) to datetime."""
    raw = str(raw).strip().strip("'\"")
    for fmt in ['%m-%d-%Y %H:%M', '%Y-%m-%d %H:%M', '%d-%m-%Y %H:%M', '%m-%d-%Y', '%Y-%m-%d']:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def get_slug(dirname):
    """Strip leading numeric prefix: '01.my-post' -> 'my-post'."""
    m = re.match(r'^\d+\.(.+)$', dirname)
    return m.group(1) if m else dirname


def parse_front_matter(text):
    """
    Manually parse YAML front matter to avoid issues with
    Grav's non-standard YAML (e.g. unescaped apostrophes in single-quoted strings).
    Returns (front_matter_dict, body_text).
    """
    if not text.startswith('---'):
        return {}, text

    end = text.find('\n---', 3)
    if end == -1:
        return {}, text

    fm_block = text[3:end].strip()
    body = text[end + 4:].lstrip('\n')

    fm = {}
    # Parse key: value pairs (top-level only, simple approach)
    # We only need: title, date, published, taxonomy.tag
    lines = fm_block.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        # title
        m = re.match(r"^title:\s*'(.*)'$", line)
        if not m:
            m = re.match(r'^title:\s*"(.*)"$', line)
        if not m:
            m = re.match(r'^title:\s+(.+)$', line)
        if m:
            fm['title'] = m.group(1).replace("'s", "’s")  # curly apostrophe
            i += 1
            continue

        # date
        m = re.match(r"^date:\s*'(.*)'$", line)
        if not m:
            m = re.match(r'^date:\s+"(.*)"$', line)
        if not m:
            m = re.match(r'^date:\s+(.+)$', line)
        if m:
            fm['date'] = m.group(1)
            i += 1
            continue

        # published
        m = re.match(r'^published:\s+(true|false)$', line, re.IGNORECASE)
        if m:
            fm['published'] = m.group(1).lower() == 'true'
            i += 1
            continue

        # taxonomy block
        if re.match(r'^taxonomy:', line):
            tags = []
            i += 1
            while i < len(lines) and (lines[i].startswith(' ') or lines[i].startswith('\t')):
                tag_m = re.match(r"^\s+-\s+'?([^']+)'?\s*$", lines[i])
                if tag_m and 'Class ' in tag_m.group(1) or \
                   tag_m and 'Level ' in tag_m.group(1) or \
                   tag_m and 'tag' not in tag_m.group(1) and 'category' not in tag_m.group(1):
                    if tag_m:
                        candidate = tag_m.group(1).strip()
                        # Only collect actual tags (not 'blog' category etc.)
                        if candidate not in ('blog',) and not candidate.endswith(':'):
                            tags.append(candidate)
                i += 1
            if tags:
                fm['tags'] = tags
            continue

        i += 1

    return fm, body


def collect_tags(fm_block):
    """Extract tags from taxonomy section."""
    tags = []
    in_taxonomy = False
    in_tag = False
    for line in fm_block.split('\n'):
        if re.match(r'^taxonomy:', line):
            in_taxonomy = True
            continue
        if in_taxonomy:
            if re.match(r'^\S', line) and not line.startswith(' '):
                in_taxonomy = False
                in_tag = False
                continue
            if re.match(r'^\s+tag:', line):
                in_tag = True
                continue
            if in_tag:
                m = re.match(r"^\s+-\s+'?([^'\\]+)'?\s*$", line)
                if m:
                    t = m.group(1).strip()
                    if t not in ('blog',):
                        tags.append(t)
                elif re.match(r'^\s+\S+:', line):
                    in_tag = False
    return tags


def dump_front_matter(fm):
    lines = ['---']
    lines.append(f"layout: post")
    title = fm.get('title', '').replace("'", "''")
    lines.append(f"title: '{title}'")
    date_str = fm.get('jekyll_date', '2023-01-01')
    lines.append(f"date: {date_str}")
    if not fm.get('published', True):
        lines.append('published: false')
    tags = fm.get('tags', [])
    if tags:
        lines.append('tags:')
        for t in tags:
            t_clean = t.replace("'", "''")
            lines.append(f"  - '{t_clean}'")
    lines.append('---')
    return '\n'.join(lines) + '\n'


def migrate():
    skipped = []
    converted = []
    slug_counts = {}

    post_dirs = sorted(
        [d for d in GRAV_BLOG.iterdir() if d.is_dir() and re.match(r'^\d+\.', d.name)],
        key=lambda d: int(re.match(r'^(\d+)\.', d.name).group(1))
    )

    for post_dir in post_dirs:
        blog_md = post_dir / 'blog.md'
        if not blog_md.exists():
            continue

        try:
            text = blog_md.read_text(encoding='utf-8', errors='replace')
        except Exception as e:
            skipped.append((post_dir.name, str(e)))
            continue

        # Parse front matter and body
        if not text.startswith('---'):
            skipped.append((post_dir.name, 'no front matter'))
            continue

        end = text.find('\n---', 3)
        if end == -1:
            skipped.append((post_dir.name, 'unclosed front matter'))
            continue

        fm_block = text[3:end]
        body = text[end + 4:].lstrip('\n')

        # Extract fields manually
        title = ''
        m = re.search(r"^title:\s*'(.*?)'", fm_block, re.MULTILINE)
        if not m:
            m = re.search(r'^title:\s+"(.*?)"', fm_block, re.MULTILINE)
        if not m:
            m = re.search(r'^title:\s+(.+)', fm_block, re.MULTILINE)
        if m:
            title = m.group(1).strip()

        date_raw = ''
        for date_key in ('date', 'publish_date'):
            m = re.search(rf"^{date_key}:\s*'(.*?)'", fm_block, re.MULTILINE)
            if not m:
                m = re.search(rf'^{date_key}:\s+"(.*?)"', fm_block, re.MULTILINE)
            if not m:
                m = re.search(rf'^{date_key}:\s+(\S+)', fm_block, re.MULTILINE)
            if m:
                date_raw = m.group(1).strip()
                break

        published = True
        m = re.search(r'^published:\s+(true|false)', fm_block, re.MULTILINE | re.IGNORECASE)
        if m:
            published = m.group(1).lower() == 'true'

        tags = collect_tags(fm_block)

        # Parse date
        date_obj = parse_date(date_raw)
        if not date_obj:
            date_obj = datetime(2023, 1, 1)
            print(f"  [WARN] Could not parse date '{date_raw}' in {post_dir.name}, using 2023-01-01")

        jekyll_date = date_obj.strftime('%Y-%m-%d')

        # Generate slug
        slug = get_slug(post_dir.name)
        base_filename = f"{jekyll_date}-{slug}"

        # Handle duplicates
        if base_filename in slug_counts:
            slug_counts[base_filename] += 1
            filename = f"{base_filename}-{slug_counts[base_filename]}.md"
        else:
            slug_counts[base_filename] = 1
            filename = f"{base_filename}.md"

        # Build output
        title_escaped = title.replace("'", "’")
        fm_out = {
            'title': title_escaped,
            'jekyll_date': jekyll_date,
            'published': published,
            'tags': tags,
        }
        output = dump_front_matter(fm_out) + '\n' + body

        (JEKYLL_POSTS / filename).write_text(output, encoding='utf-8')
        converted.append(filename)

    print(f"\nMigration complete.")
    print(f"  Converted: {len(converted)}")
    print(f"  Skipped:   {len(skipped)}")
    if skipped:
        print("\nSkipped posts:")
        for name, reason in skipped:
            print(f"  - {name}: {reason}")


if __name__ == '__main__':
    migrate()
