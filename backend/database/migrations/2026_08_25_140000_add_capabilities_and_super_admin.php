<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Break-glass "System Administrator" identity (spec Part II §1).
            $table->boolean('is_super_admin')->default(false)->index();
        });

        // Granular capabilities granted per role (editable via the RBAC screen).
        Schema::create('role_capabilities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('role_id')->constrained('roles')->cascadeOnDelete();
            $table->string('capability');
            $table->timestamps();

            $table->unique(['role_id', 'capability']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('role_capabilities');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('is_super_admin');
        });
    }
};
