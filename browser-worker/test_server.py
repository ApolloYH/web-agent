#!/usr/bin/env python3
import asyncio
import unittest
from types import SimpleNamespace

import server


async def async_value(value):
    return value


class SessionStoreTest(unittest.TestCase):
    def setUp(self):
        with server.SESSIONS_LOCK:
            server.SESSIONS.clear()

    def test_session_metadata_and_frame_are_kept_separate(self):
        server.create_session("session-1")
        server.update_session("session-1", frame=b"jpeg", frame_mime="image/jpeg", status="running", title="Example")

        snapshot = server.session_snapshot("session-1")
        self.assertEqual(snapshot["title"], "Example")
        self.assertTrue(snapshot["frame_version"])
        self.assertNotIn("frame", snapshot)
        self.assertEqual(server.session_frame("session-1"), (b"jpeg", "image/jpeg"))

    def test_session_ids_are_restricted(self):
        self.assertTrue(server.valid_session_id("abc-123"))
        self.assertFalse(server.valid_session_id("../secret"))

    def test_legacy_browser_profile_keeps_private_networks_blocked(self):
        options = server.browser_profile_options([])
        self.assertTrue(options["block_ip_addresses"])
        self.assertIn("localhost", options["prohibited_domains"])

    def test_unsafe_allowed_domains_are_rejected(self):
        for domain in ["*", "localhost", "*.localhost", "127.0.0.1", "metadata.google.internal", "printer.local"]:
            self.assertTrue(server.unsafe_allowed_domain(domain), domain)
        self.assertFalse(server.unsafe_allowed_domain("*.example.com"))

    def test_browser_input_is_restricted_to_normalized_viewport(self):
        command = server.normalize_browser_input({"type": "click", "x": 0.25, "y": 0.75})
        self.assertEqual(command, {"type": "click", "x": 0.25, "y": 0.75})
        with self.assertRaises(ValueError):
            server.normalize_browser_input({"type": "click", "x": 2, "y": 0.5})
        with self.assertRaises(ValueError):
            server.normalize_browser_input({"type": "text", "text": "x" * 4001})
        self.assertEqual(server.normalize_browser_input({"type": "resume"}), {"type": "resume"})

    def test_click_pauses_agent_and_uses_viewport_coordinates(self):
        calls = []

        class Input:
            async def dispatchMouseEvent(self, params, session_id=None):
                calls.append((params, session_id))

        class Page:
            async def getLayoutMetrics(self, session_id=None):
                return {"cssVisualViewport": {"clientWidth": 1000, "clientHeight": 500}}

        cdp = SimpleNamespace(cdp_client=SimpleNamespace(send=SimpleNamespace(Input=Input(), Page=Page())), session_id="cdp")
        browser = SimpleNamespace(get_or_create_cdp_session=lambda **_kwargs: async_value(cdp))

        class Agent:
            state = SimpleNamespace(paused=False)
            browser_session = browser

            def pause(self):
                self.state.paused = True

            def resume(self):
                self.state.paused = False

        server.create_session("interactive")
        agent = Agent()
        asyncio.run(server.dispatch_browser_input("interactive", agent, {"type": "click", "x": 0.25, "y": 0.5}))
        self.assertTrue(agent.state.paused)
        self.assertEqual(calls[0][0]["x"], 250)
        self.assertEqual(calls[0][0]["y"], 250)
        asyncio.run(server.dispatch_browser_input("interactive", agent, {"type": "resume"}))
        self.assertFalse(agent.state.paused)


if __name__ == "__main__":
    unittest.main()
