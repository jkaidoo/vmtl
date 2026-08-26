<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicle_requests', function (Blueprint $table) {
            $table->id();
            $table->string('request_number')->unique();     // e.g. REQ-00031
            $table->foreignId('requester_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('department_id')->nullable()->constrained('departments')->nullOnDelete();
            $table->date('travel_date');
            $table->dateTime('requested_start_time');
            $table->dateTime('expected_end_time');
            $table->string('destination');
            $table->string('additional_destination')->nullable();
            $table->text('purpose');
            $table->unsignedSmallInteger('passenger_count')->default(1);
            $table->string('contact_number')->nullable();
            $table->string('special_requirements')->nullable();
            $table->text('remarks')->nullable();
            $table->string('status')->default('pending')->index();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'travel_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_requests');
    }
};
