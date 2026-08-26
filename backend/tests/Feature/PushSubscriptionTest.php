<?php

namespace Tests\Feature;

use App\Enums\RoleType;
use App\Services\WebPushService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PushSubscriptionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRolesAndDepartment();
    }

    public function test_user_can_register_a_push_subscription(): void
    {
        $user = $this->makeUser(RoleType::STAFF);

        $this->actingAs($user)->postJson('/api/push/subscribe', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/example-endpoint-123',
            'keys' => ['p256dh' => 'BPublicKeyExample', 'auth' => 'AuthTokenExample'],
        ])->assertCreated();

        $this->assertDatabaseHas('push_subscriptions', [
            'user_id' => $user->id,
            'endpoint_hash' => hash('sha256', 'https://fcm.googleapis.com/fcm/send/example-endpoint-123'),
        ]);
    }

    public function test_subscription_is_idempotent_per_endpoint(): void
    {
        $user = $this->makeUser(RoleType::STAFF);
        $payload = [
            'endpoint' => 'https://example.push/endpoint-abc',
            'keys' => ['p256dh' => 'key1', 'auth' => 'auth1'],
        ];

        $this->actingAs($user)->postJson('/api/push/subscribe', $payload)->assertCreated();
        $this->actingAs($user)->postJson('/api/push/subscribe', $payload)->assertCreated();

        $this->assertSame(1, $user->pushSubscriptions()->count());
    }

    public function test_user_can_unsubscribe(): void
    {
        $user = $this->makeUser(RoleType::STAFF);
        $this->actingAs($user)->postJson('/api/push/subscribe', [
            'endpoint' => 'https://example.push/gone',
            'keys' => ['p256dh' => 'k', 'auth' => 'a'],
        ])->assertCreated();

        $this->actingAs($user)->postJson('/api/push/unsubscribe', ['endpoint' => 'https://example.push/gone'])->assertOk();

        $this->assertSame(0, $user->pushSubscriptions()->count());
    }

    public function test_sending_to_a_user_without_subscriptions_is_a_safe_noop(): void
    {
        $user = $this->makeUser(RoleType::STAFF);

        app(WebPushService::class)->sendToUser($user, ['title' => 'Hi', 'body' => 'test']);

        $this->assertTrue(true); // no exception thrown
    }
}
