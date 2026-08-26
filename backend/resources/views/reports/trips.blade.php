<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $reportTitle ?? 'Vehicle Usage Report' }}</title>
    <style>
        * { font-family: DejaVu Sans, sans-serif; }
        body { font-size: 10px; color: #1f2937; margin: 0; }
        h1 { font-size: 16px; margin: 0 0 2px; color: #111827; }
        .muted { color: #6b7280; font-size: 9px; }
        .meta { margin: 6px 0 10px; }
        .meta span { display: inline-block; margin-right: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; vertical-align: top; }
        th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; }
        tr:nth-child(even) td { background: #fafafa; }
        .totals { margin-top: 10px; font-size: 11px; }
        .totals strong { color: #111827; }
        .header { border-bottom: 2px solid #1d4ed8; padding-bottom: 6px; margin-bottom: 8px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>UITS {{ $reportTitle ?? 'Vehicle Usage Report' }}</h1>
        <div class="muted">Generated {{ $generatedAt }}</div>
    </div>

    <div class="meta">
        @if(!empty($filters['date_from']) || !empty($filters['date_to']))
            <span><strong>Period:</strong> {{ $filters['date_from'] ?? '—' }} to {{ $filters['date_to'] ?? '—' }}</span>
        @endif
        @if(!empty($filters['destination']))
            <span><strong>Destination:</strong> {{ $filters['destination'] }}</span>
        @endif
        @if(!empty($filters['status']))
            <span><strong>Status:</strong> {{ $filters['status'] }}</span>
        @endif
    </div>

    <table>
        <thead>
            <tr>
                @foreach($headings as $h)
                    <th>{{ $h }}</th>
                @endforeach
            </tr>
        </thead>
        <tbody>
            @forelse($rows as $row)
                <tr>
                    @foreach($row as $cell)
                        <td>{{ $cell }}</td>
                    @endforeach
                </tr>
            @empty
                <tr><td colspan="{{ count($headings) }}" style="text-align:center;color:#9ca3af;">No records match the selected filters.</td></tr>
            @endforelse
        </tbody>
    </table>

    <div class="totals">
        @foreach($totalsPairs as $pair)
            <strong>{{ $pair['label'] }}:</strong> {{ $pair['value'] }}@if(!$loop->last) &nbsp;·&nbsp; @endif
        @endforeach
    </div>
</body>
</html>
