/**
 * @jest-environment node
 */
import { pingKeepalive } from "../../scripts/supabase-keepalive";

const envBase = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

describe("pingKeepalive", () => {
  it("POSTs to /rest/v1/keepalive_log with service_role headers and default source", async () => {
    const fetchMock = jest.fn(async () => new Response(null, { status: 201 }));
    await pingKeepalive(envBase, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const calledUrl = firstCall[0];
    const init = firstCall[1];
    expect(calledUrl).toBe("https://example.supabase.co/rest/v1/keepalive_log");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      apikey: "service-role-key",
      Authorization: "Bearer service-role-key",
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    });
    expect(JSON.parse(init.body as string)).toEqual({ source: "github-actions" });
  });

  it("uses KEEPALIVE_SOURCE override when provided", async () => {
    const fetchMock = jest.fn(async () => new Response(null, { status: 201 }));
    await pingKeepalive({ ...envBase, KEEPALIVE_SOURCE: "manual" }, fetchMock);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const init = firstCall[1];
    expect(JSON.parse(init.body as string)).toEqual({ source: "manual" });
  });

  it("strips trailing slash from SUPABASE_URL", async () => {
    const fetchMock = jest.fn(async () => new Response(null, { status: 201 }));
    await pingKeepalive({ ...envBase, SUPABASE_URL: "https://example.supabase.co/" }, fetchMock);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toBe("https://example.supabase.co/rest/v1/keepalive_log");
  });

  it("throws with response body when status is not ok", async () => {
    const fetchMock = jest.fn(
      async () => new Response("boom", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(pingKeepalive(envBase, fetchMock)).rejects.toThrow(/500/);
    await expect(pingKeepalive(envBase, fetchMock)).rejects.toThrow(/boom/);
  });
});
