<?php

namespace App\Models;

use App\Enums\OrgUnitType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Organisational unit in the university tree (College → Faculty → Department →
 * Unit → Office, plus Directorates). Subtree scoping uses a materialised `path`
 * of ancestor ids (e.g. "/1/2/5/") so descendants are a cheap `path LIKE` query.
 */
class OrgUnit extends Model
{
    use SoftDeletes;

    protected $fillable = ['name', 'code', 'type', 'parent_id', 'path', 'active'];

    protected function casts(): array
    {
        return [
            'type' => OrgUnitType::class,
            'active' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        // Maintain the materialised path once the id is known.
        static::created(function (OrgUnit $unit) {
            $unit->refreshPath();
        });

        static::updated(function (OrgUnit $unit) {
            if ($unit->wasChanged('parent_id')) {
                $unit->refreshPath(cascade: true);
            }
        });
    }

    /** Recompute this unit's path from its parent, optionally cascading to descendants. */
    public function refreshPath(bool $cascade = false): void
    {
        $parentPath = $this->parent_id ? (OrgUnit::withTrashed()->find($this->parent_id)?->path ?? '/') : '/';
        $newPath = $parentPath.$this->id.'/';

        if ($this->path !== $newPath) {
            $this->path = $newPath;
            $this->saveQuietly();
        }

        if ($cascade) {
            foreach ($this->children()->get() as $child) {
                $child->refreshPath(cascade: true);
            }
        }
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(OrgUnit::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(OrgUnit::class, 'parent_id');
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function vehicles(): HasMany
    {
        return $this->hasMany(Vehicle::class);
    }

    public function drivers(): HasMany
    {
        return $this->hasMany(Driver::class);
    }

    /**
     * Ids of this unit and every descendant (self included).
     *
     * @return array<int,int>
     */
    public function subtreeIds(): array
    {
        $path = $this->path ?: '/'.$this->id.'/';

        return OrgUnit::query()
            ->where(fn ($q) => $q->where('id', $this->id)->orWhere('path', 'like', $path.'%'))
            ->pluck('id')->all();
    }

    /**
     * Ids of this unit and every ancestor (self included) — used for "serving"
     * scope so a parent/central pool can fulfil a sub-unit's request.
     *
     * @return array<int,int>
     */
    public function pathIds(): array
    {
        $trimmed = trim($this->path ?: '/'.$this->id.'/', '/');

        return $trimmed === '' ? [$this->id] : array_map('intval', explode('/', $trimmed));
    }
}
