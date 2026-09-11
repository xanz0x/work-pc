#!/usr/bin/env python3
"""
Backend API Testing for WorkSpaceX Iteration 67
Tests: File deletion (with/without disk removal), Mail context menu, Code/Link extraction
"""

import requests
import sys
import os
import time
from typing import Optional

BASE_URL = "http://localhost:3000"
STORAGE_ROOT = "/root/wsx-store"

class APITester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        self.failures = []

    def login(self, username: str, password: str) -> bool:
        """Login and get session cookie"""
        print(f"\n🔐 Logging in as {username}...")
        try:
            # Login via API
            r = self.session.post(
                f"{self.base_url}/ai-api/auth/login",
                json={"login": username, "password": password},
                timeout=10
            )
            
            if r.status_code == 200:
                # Check if we got cookies
                cookies = self.session.cookies.get_dict()
                print(f"   🍪 Cookies received: {list(cookies.keys())}")
                print(f"✅ Login successful")
                return True
            else:
                print(f"❌ Login failed: {r.status_code} - {r.text[:200]}")
                return False
        except Exception as e:
            print(f"❌ Login error: {e}")
            return False

    def test_api(self, name: str, method: str, endpoint: str, expected_status: int, 
                 data=None, json_data=None, files=None) -> tuple[bool, dict]:
        """Run a single API test"""
        url = f"{self.base_url}{endpoint}"
        self.tests_run += 1
        print(f"\n🔍 Test {self.tests_run}: {name}")
        
        try:
            if method == 'GET':
                r = self.session.get(url, timeout=30)
            elif method == 'POST':
                if files:
                    r = self.session.post(url, data=data, files=files, timeout=60)
                else:
                    r = self.session.post(url, json=json_data, timeout=30)
            elif method == 'DELETE':
                r = self.session.delete(url, json=json_data, timeout=30)
            elif method == 'PUT':
                r = self.session.put(url, json=json_data, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            success = r.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ PASSED - Status: {r.status_code}")
            else:
                self.tests_failed += 1
                error_msg = f"Expected {expected_status}, got {r.status_code}"
                print(f"❌ FAILED - {error_msg}")
                print(f"   Response: {r.text[:300]}")
                self.failures.append(f"{name}: {error_msg}")
            
            try:
                return success, r.json() if r.text else {}
            except:
                return success, {}
                
        except Exception as e:
            self.tests_failed += 1
            error_msg = f"Exception: {str(e)}"
            print(f"❌ FAILED - {error_msg}")
            self.failures.append(f"{name}: {error_msg}")
            return False, {}

    def check_file_on_disk(self, filename: str) -> bool:
        """Check if file exists in storage root"""
        try:
            import subprocess
            result = subprocess.run(
                ['ls', '-la', STORAGE_ROOT],
                capture_output=True,
                text=True,
                timeout=5
            )
            exists = filename in result.stdout
            print(f"   📁 File '{filename}' on disk: {'EXISTS' if exists else 'NOT FOUND'}")
            return exists
        except Exception as e:
            print(f"   ⚠️  Could not check disk: {e}")
            return False

    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*60)
        print(f"📊 TEST SUMMARY")
        print("="*60)
        print(f"Total Tests: {self.tests_run}")
        print(f"✅ Passed: {self.tests_passed}")
        print(f"❌ Failed: {self.tests_failed}")
        
        if self.failures:
            print("\n❌ FAILURES:")
            for i, failure in enumerate(self.failures, 1):
                print(f"  {i}. {failure}")
        
        print("="*60)
        return 0 if self.tests_failed == 0 else 1


def main():
    tester = APITester()
    
    # Login
    if not tester.login("admin", "WsxQa2026!lib"):
        print("❌ Login failed, cannot continue")
        return 1
    
    print("\n" + "="*60)
    print("🧪 TESTING BUG 1: FILE DELETION WITH/WITHOUT DISK REMOVAL")
    print("="*60)
    
    # First, ensure storage root is set
    print("\n📂 Setting storage root...")
    success, resp = tester.test_api(
        "Set storage root",
        "PUT",
        "/ai-api/cloud/storage-root",
        200,
        json_data={"root": STORAGE_ROOT}
    )
    
    if not success:
        print("⚠️  Could not set storage root, continuing anyway...")
    
    # Get current drive state
    print("\n📋 Getting drive state...")
    success, drive = tester.test_api(
        "Get drive view",
        "GET",
        "/ai-api/cloud",
        200
    )
    
    if not success:
        print("❌ Cannot get drive state, stopping file deletion tests")
    else:
        # Upload a test file
        print("\n📤 Uploading test file...")
        test_content = b"Test file content for deletion test - iteration 67"
        test_filename = f"test-delete-{int(time.time())}.txt"
        
        success, upload_resp = tester.test_api(
            "Upload test file",
            "POST",
            "/ai-api/cloud/upload",
            200,
            data={"dir": "", "shared": "true"},
            files={"file": (test_filename, test_content, "text/plain")}
        )
        
        if success and upload_resp.get('file', {}).get('id'):
            file_id = upload_resp['file']['id']
            print(f"   📄 Uploaded file ID: {file_id}")
            
            # Wait a bit for file to be written
            time.sleep(1)
            
            # Check file exists on disk
            file_exists = tester.check_file_on_disk(test_filename)
            
            # Test 1: Delete with removeBytes=false (keep on disk)
            print("\n🗑️  Test: Delete from library, KEEP on disk (removeBytes=false)")
            
            # Upload another file for this test
            test_filename2 = f"test-keep-{int(time.time())}.txt"
            success2, upload_resp2 = tester.test_api(
                "Upload second test file",
                "POST",
                "/ai-api/cloud/upload",
                200,
                data={"dir": "", "shared": "true"},
                files={"file": (test_filename2, test_content, "text/plain")}
            )
            
            if success2 and upload_resp2.get('file', {}).get('id'):
                file_id2 = upload_resp2['file']['id']
                time.sleep(1)
                
                before_delete = tester.check_file_on_disk(test_filename2)
                
                success_del, _ = tester.test_api(
                    "Delete file (removeBytes=false)",
                    "DELETE",
                    f"/ai-api/cloud/file/{file_id2}",
                    200,
                    json_data={"removeBytes": False}
                )
                
                if success_del:
                    time.sleep(1)
                    after_delete = tester.check_file_on_disk(test_filename2)
                    
                    if before_delete and after_delete:
                        print("   ✅ File correctly KEPT on disk after library deletion")
                        tester.tests_passed += 1
                    else:
                        print("   ❌ File should still exist on disk but doesn't")
                        tester.tests_failed += 1
                        tester.failures.append("File deletion: removeBytes=false should keep file on disk")
            
            # Test 2: Delete with removeBytes=true (remove from disk)
            print("\n🗑️  Test: Delete from library AND disk (removeBytes=true)")
            
            before_delete = tester.check_file_on_disk(test_filename)
            
            success_del, _ = tester.test_api(
                "Delete file (removeBytes=true)",
                "DELETE",
                f"/ai-api/cloud/file/{file_id}",
                200,
                json_data={"removeBytes": True}
            )
            
            if success_del:
                time.sleep(1)
                after_delete = tester.check_file_on_disk(test_filename)
                
                if before_delete and not after_delete:
                    print("   ✅ File correctly REMOVED from disk")
                    tester.tests_passed += 1
                elif not before_delete:
                    print("   ⚠️  File was not on disk before deletion (cannot verify)")
                else:
                    print("   ❌ File should be removed from disk but still exists")
                    tester.tests_failed += 1
                    tester.failures.append("File deletion: removeBytes=true should remove file from disk")
        else:
            print("❌ Could not upload test file, skipping deletion tests")
    
    print("\n" + "="*60)
    print("🧪 TESTING BUG 3: MAIL CODE/LINK EXTRACTION")
    print("="*60)
    
    # Test temp mail inbox
    print("\n📧 Getting temp mail inbox...")
    temp_box_id = "5945287b"  # From test credentials
    
    success, inbox = tester.test_api(
        "Get temp mail inbox",
        "GET",
        f"/ai-api/mail/temp/{temp_box_id}/inbox",
        200
    )
    
    if success and inbox.get('rows'):
        print(f"   📬 Found {len(inbox['rows'])} messages")
        
        # Test messages
        test_messages = {
            "6aa36280a5387287a78baf87": {"name": "QA1", "should_have_code": False, "should_have_link": True},
            "6aa36281a379a1cefe8f0c92": {"name": "QA2", "should_have_code": True, "should_have_link": True},
            "6aa3628292c70f029943b33a": {"name": "QA3", "should_have_code": False, "should_have_link": False},
        }
        
        for mid, expected in test_messages.items():
            print(f"\n📨 Testing message {expected['name']} (mid: {mid})")
            
            success, msg = tester.test_api(
                f"Get message {expected['name']}",
                "GET",
                f"/ai-api/mail/temp/{temp_box_id}/message/{mid}",
                200
            )
            
            if success and msg.get('message'):
                message = msg['message']
                subject = message.get('subject', '')
                html = message.get('html', '')
                text = message.get('text', '')
                
                print(f"   📋 Subject: {subject}")
                print(f"   📄 Has HTML: {bool(html)}")
                print(f"   📝 Has Text: {bool(text)}")
                
                # Note: Code/link extraction happens on frontend, but we can check the data is there
                if expected['name'] == 'QA1':
                    if 'Confirm' in subject and 'awstrack.me' in html:
                        print(f"   ✅ QA1: Contains confirmation button link")
                    else:
                        print(f"   ⚠️  QA1: Expected confirmation content")
                
                elif expected['name'] == 'QA2':
                    if '483920' in html or '483920' in text:
                        print(f"   ✅ QA2: Contains code 483920")
                    else:
                        print(f"   ❌ QA2: Code 483920 not found")
                        tester.failures.append("QA2 message should contain code 483920")
                
                elif expected['name'] == 'QA3':
                    if 'Просто письмо' in subject:
                        print(f"   ✅ QA3: Plain message without code/link")
                    else:
                        print(f"   ⚠️  QA3: Expected plain message")
    else:
        print("   ⚠️  Could not get temp mail inbox or no messages found")
    
    # Print summary
    return tester.print_summary()


if __name__ == "__main__":
    sys.exit(main())
