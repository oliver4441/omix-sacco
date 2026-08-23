import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { z } from 'zod';

const readSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).optional(),
  all: z.boolean().optional(),
});

/**
 * PATCH /api/notifications/read   (any authenticated user)
 * Body: { ids: uuid[] } or { all: true } — stamps read_at on the caller's own
 * notifications only. Returns the number of rows updated.
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = readSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { ids, all } = parsed.data;
  if (!all && (ids === undefined || ids.length === 0)) {
    return NextResponse.json(
      { error: 'Provide a non-empty ids array or { all: true }' },
      { status: 400 }
    );
  }

  try {
    const result =
      all === true
        ? await query(
            `UPDATE notifications SET read_at = NOW()
             WHERE user_id = $1 AND read_at IS NULL`,
            [session.userId]
          )
        : await query(
            `UPDATE notifications SET read_at = NOW()
             WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`,
            [session.userId, ids as string[]]
          );

    return NextResponse.json({ updated: result.rowCount ?? 0 });
  } catch (error) {
    console.error('PATCH /api/notifications/read:', error);
    return NextResponse.json({ error: 'Failed to mark notifications read' }, { status: 500 });
  }
}
