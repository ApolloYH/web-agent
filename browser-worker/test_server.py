#!/usr/bin/env python3
import unittest

import server


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


if __name__ == "__main__":
    unittest.main()
