import pytest

from lib.page_state import WindowStateError, WindowStateMachine


def test_window_state_tracks_parent_child_close_and_safe_reopen():
    state = WindowStateMachine()
    parent = "123root" + "a" * 32
    child = "b" * 32
    reopened = "c" * 32

    state.bind("list_form", parent, source="menu")
    state.bind(
        "dialog_form",
        child,
        source="showForm",
        parent_form_id="list_form",
        parent_page_id=parent,
    )
    state.close_page(child, source="closeWindow")

    with pytest.raises(WindowStateError):
        state.assert_usable("dialog_form", child)

    state.bind(
        "dialog_form",
        reopened,
        source="showForm",
        parent_form_id="list_form",
        parent_page_id=parent,
    )
    state.assert_usable("dialog_form", reopened)
    snapshot = state.snapshot()

    dialog = next(item for item in snapshot["current"] if item["form_id"] == "dialog_form")
    assert dialog["generation"] == 2
    assert dialog["status"] == "open"
    assert dialog["parent_page_id_ref"]


def test_window_state_rejects_same_pageid_after_close():
    state = WindowStateMachine()
    page_id = "d" * 32

    state.bind("dialog_form", page_id, source="showForm")
    state.close_form("dialog_form", source="closeWindow")
    state.bind("dialog_form", page_id, source="bad_reopen")

    with pytest.raises(WindowStateError):
        state.assert_usable("dialog_form", page_id)

    assert state.is_usable("dialog_form", page_id) is False
    assert state.snapshot()["issues"][0]["code"] == "closed_pageid_reused"
