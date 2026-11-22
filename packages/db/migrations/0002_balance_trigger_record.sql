-- Correct polymorphic trigger record access; retains all existing schema/history.
CREATE OR REPLACE FUNCTION check_entry_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_id uuid; total numeric; lines integer;
BEGIN
 IF TG_TABLE_NAME='documents' THEN entry_id:=NEW.id; ELSE entry_id:=NEW.document_id; END IF;
 SELECT coalesce(sum(debit-credit),0),count(*) INTO total,lines FROM journal WHERE document_id=entry_id;
 IF total<>0 OR lines<2 THEN RAISE EXCEPTION 'Entry must balance and have at least two lines' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
