#!/usr/bin/env python3
"""Check explicit function privileges in repository SQL using lexical parsing."""
from pathlib import Path
import re
import sys

INTERNAL = set('acct_eval_formulas fund_account_codes fund_codes fund_has_statement fund_line_sum fund_prev_yearmonth fund_reconcile_one get_consolidated_statement perf_all_corps perf_yjc_offices perf_target_bucket_offices perf_target_bucket'.split())


def lex(sql):
    """Yield (kind, text); quoted bodies and comments are indivisible tokens."""
    i = 0
    while i < len(sql):
        start = i
        if sql[i].isspace():
            i += 1
            continue
        if sql.startswith('--', i):
            end = sql.find('\n', i)
            i = len(sql) if end < 0 else end
            yield 'comment', sql[start:i]
        elif sql.startswith('/*', i):
            i += 2
            depth = 1
            while i < len(sql) and depth:
                if sql.startswith('/*', i):
                    depth += 1
                    i += 2
                elif sql.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise ValueError('unterminated block comment')
            yield 'comment', sql[start:i]
        elif sql[i] in "'\"":
            quote = sql[i]
            escape = quote == "'" and start > 0 and sql[start - 1:start].lower() == 'e'
            i += 1
            while i < len(sql):
                if escape and sql[i] == '\\':
                    i += 2
                elif sql[i] == quote:
                    i += 1
                    if i < len(sql) and sql[i] == quote:
                        i += 1
                    else:
                        break
                else:
                    i += 1
            else:
                raise ValueError('unterminated quote')
            yield ('ident' if quote == '"' else 'literal'), sql[start:i]
        elif sql[i] == '$' and (m := re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$', sql[i:])):
            tag = m.group()
            end = sql.find(tag, i + len(tag))
            if end < 0:
                raise ValueError('unterminated dollar quote')
            i = end + len(tag)
            yield 'body', sql[start:i]
        elif m := re.match(r'[A-Za-z_][A-Za-z_0-9$]*|[0-9]+', sql[i:]):
            i += len(m.group())
            yield 'word', m.group().lower()
        else:
            i += 1
            yield 'symbol', sql[start:i]


def statements(sql):
    result, current, comments = [], [], []
    for kind, token in lex(sql):
        if kind == 'comment':
            comments.append(token)
        elif token == ';' and kind == 'symbol':
            if current:
                result.append(current)
            current = []
        else:
            current.append(token)
    if current:
        result.append(current)
    return result, comments


def identifier(token):
    return token[1:-1].replace('""', '"') if token.startswith('"') else token.lower()


def split_args(tokens):
    parts, part, depth = [], [], 0
    for token in tokens:
        if token == ',' and depth == 0:
            parts.append(part)
            part = []
        else:
            part.append(token)
            if token in ('(', '['):
                depth += 1
            elif token in (')', ']'):
                depth -= 1
    if part:
        parts.append(part)
    return parts


def arg_type(part, declaration):
    depth = 0
    for i, token in enumerate(part):
        if depth == 0 and token in ('default', '='):
            part = part[:i]
            break
        if token in ('(', '['):
            depth += 1
        elif token in (')', ']'):
            depth -= 1
    mode = part[0] if part and part[0] in ('in', 'out', 'inout', 'variadic') else None
    if mode:
        part = part[1:]
    if mode == 'out':
        return None
    if declaration and len(part) > 1:
        # Multiword builtin types can occur without an argument name.
        starts_type = part[0] in ('double', 'character', 'bit', 'timestamp', 'time', 'interval', 'national')
        continuation = part[1] in ('[', '(', '.', '%')
        if not starts_type and not continuation:
            part = part[1:]
    text = ' '.join(part).lower()
    text = re.sub(r'\s*([.\[\](),%])\s*', r'\1', text)
    return text


def signature(tokens, pos, declaration=False):
    name = identifier(tokens[pos])
    pos += 1
    schema = 'public'
    if tokens[pos] == '.':
        schema, name = name, identifier(tokens[pos + 1])
        pos += 2
    if tokens[pos] != '(':
        raise ValueError('expected function argument list')
    start, depth = pos + 1, 1
    pos += 1
    while pos < len(tokens) and depth:
        depth += (tokens[pos] == '(') - (tokens[pos] == ')')
        pos += 1
    if depth:
        raise ValueError('unbalanced function arguments')
    args = tuple(t for p in split_args(tokens[start:pos - 1]) if (t := arg_type(p, declaration)) is not None)
    return (schema, name, args), pos


def display(sig):
    return sig[0] + '.' + sig[1] + '(' + ', '.join(sig[2]) + ')'


def parse(sql):
    stmts, comments = statements(sql)
    creates, privileges = [], []
    for t in stmts:
        if t[:2] == ['create', 'function']:
            creates.append(signature(t, 2, True)[0])
        elif t[:4] == ['create', 'or', 'replace', 'function']:
            creates.append(signature(t, 4, True)[0])
        elif t[0] in ('grant', 'revoke') and 'on' in t:
            on = t.index('on')
            if on + 1 >= len(t) or t[on + 1] != 'function':
                continue
            if not set(t[1:on]) & {'execute', 'all'}:
                continue
            pos, sigs = on + 2, []
            while True:
                sig, pos = signature(t, pos)
                sigs.append(sig)
                if t[pos] != ',':
                    break
                pos += 1
            if t[pos] not in ('to', 'from'):
                raise ValueError('expected privilege role list')
            roles = set()
            for token in t[pos + 1:]:
                if token in ('with', 'cascade', 'restrict'):
                    break
                if token != ',':
                    roles.add(identifier(token))
            privileges.extend((t[0], sig, roles) for sig in sigs)
    exemptions = set()
    for comment in comments:
        if '부여 없음' not in comment:
            continue
        toks = [v for k, v in lex(re.sub(r'^--|^/\*|\*/$', '', comment)) if k != 'comment']
        for i in range(len(toks) - 1):
            if toks[i + 1] in ('(', '.'):
                try:
                    exemptions.add(signature(toks, i)[0])
                except (ValueError, IndexError):
                    pass
    return creates, privileges, exemptions


def main():
    files = sorted(Path('supabase').rglob('*.sql'))
    errors, count, grants = [], 0, 0
    for path in files:
        if 'worker' in path.parts:
            continue
        try:
            creates, privileges, exemptions = parse(path.read_text(encoding='utf-8'))
            count += len(creates)
            grants += len(privileges)
            for action, sig, roles in privileges:
                if action == 'grant' and roles & {'public', 'authenticated'}:
                    errors.append(f'{path}: {display(sig)}: forbidden role grant')
                if action == 'grant' and sig[1] in INTERNAL and 'anon' in roles:
                    errors.append(f'{path}: {display(sig)}: internal anon grant')
            for sig in creates:
                matching = [(a, r) for a, s, r in privileges if s == sig]
                if sig[1] in INTERNAL:
                    valid = any(a == 'revoke' and {'public', 'anon', 'authenticated'} <= r for a, r in matching)
                else:
                    valid = bool(matching) or sig in exemptions
                if not valid:
                    errors.append(f'{path}: {display(sig)}: missing explicit privileges')
        except (ValueError, IndexError) as exc:
            errors.append(f'{path}: SQL parse error: {exc}')
    for error in errors:
        print(error, file=sys.stderr)
    print(f'files={len(files)} functions={count} privilege_statements={grants} errors={len(errors)}')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
